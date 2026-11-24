import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fg from 'fast-glob';
import type { ToolDefinition, ToolResultPayload } from '../types.js';
import { CodedError } from '../errors.js';
import { resolveInside, relativeDisplay, isInside } from '../utils/paths.js';
import { diffStat, unifiedDiff } from '../utils/diff.js';
import { readTextFile, truncate, withLineNumbers } from '../utils/text.js';

const execFileAsync = promisify(execFile);

const IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/coverage/**',
  '**/__pycache__/**',
  '**/.venv/**',
  '**/venv/**',
  '**/target/**',
  '**/.turbo/**',
  '**/*.lock',
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
];

const MAX_READ_BYTES = 2_000_000;

function stringArg(input: Record<string, unknown>, key: string, fallback?: string): string {
  const value = input[key];
  if (typeof value === 'string') return value;
  if (value === undefined && fallback !== undefined) return fallback;
  throw new CodedError(`Missing required string parameter "${key}".`, 'tool');
}

function numberArg(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = input[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function boolArg(input: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = input[key];
  return typeof value === 'boolean' ? value : fallback;
}

async function readForEdit(absolute: string, display: string): Promise<string> {
  let stat;
  try {
    stat = await fs.stat(absolute);
  } catch {
    throw new CodedError(`File not found: ${display}`, 'tool');
  }
  if (stat.isDirectory()) throw new CodedError(`${display} is a directory, not a file.`, 'tool');
  if (stat.size > MAX_READ_BYTES) {
    throw new CodedError(`${display} is too large to edit (${stat.size} bytes).`, 'tool');
  }
  return readTextFile(absolute);
}

async function changeSummary(
  absolute: string,
  display: string,
  oldContent: string | null,
  newContent: string,
): Promise<{ added: number; removed: number; diff: string; summary: string }> {
  const before = oldContent ?? '';
  const { added, removed } = diffStat(before, newContent);
  const diff = unifiedDiff(before, newContent, {
    oldName: oldContent === null ? '/dev/null' : `a/${display}`,
    newName: `b/${display}`,
    maxLines: 300,
  });
  const verb = oldContent === null ? 'Create' : 'Edit';
  return {
    added,
    removed,
    diff,
    summary: `${verb} ${display} (+${added} −${removed})`,
  };
}

export function createReadTools(): ToolDefinition[] {
  const readFile: ToolDefinition = {
    name: 'read_file',
    description:
      'Read a text file from the workspace. Returns numbered lines. Use offset/limit for large files.',
    readOnly: true,
    category: 'read',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the workspace root.' },
        offset: { type: 'number', description: 'First line to read (1-based). Default 1.' },
        limit: { type: 'number', description: 'Maximum number of lines to read. Default 2000.' },
      },
      required: ['path'],
    },
    preview: async (input) => ({ summary: `Read ${stringArg(input, 'path')}` }),
    async run(input, ctx): Promise<ToolResultPayload> {
      const display = stringArg(input, 'path');
      const absolute = resolveInside(ctx.workspace, display);
      let stat;
      try {
        stat = await fs.stat(absolute);
      } catch {
        return { content: `File not found: ${display}`, isError: true };
      }
      if (stat.isDirectory()) {
        return { content: `${display} is a directory. Use list_dir instead.`, isError: true };
      }
      if (stat.size > MAX_READ_BYTES) {
        return {
          content: `${display} is ${stat.size} bytes, too large to read at once. Use grep to find the relevant section, then read with offset/limit.`,
          isError: true,
        };
      }

      const text = await readTextFile(absolute);
      const lines = text.split('\n');
      const offset = Math.max(1, Math.floor(numberArg(input, 'offset', 1)));
      const limit = Math.min(5000, Math.max(1, Math.floor(numberArg(input, 'limit', 2000))));
      const slice = lines.slice(offset - 1, offset - 1 + limit);
      if (slice.length === 0) {
        return { content: `${display} has ${lines.length} lines; offset ${offset} is past the end.`, isError: true };
      }
      const numbered = withLineNumbers(slice.join('\n'), offset);
      const more = offset - 1 + slice.length < lines.length;
      const suffix = more ? `\n\n… ${lines.length - (offset - 1 + slice.length)} more lines. Read again with offset=${offset + slice.length}.` : '';
      return {
        content: truncate(numbered, 120_000) + suffix,
        metadata: { path: display, lines: slice.length, totalLines: lines.length },
      };
    },
  };

  const listDir: ToolDefinition = {
    name: 'list_dir',
    description:
      'List the workspace directory tree. Skips node_modules, .git, build output and lockfiles. Use depth to go deeper.',
    readOnly: true,
    category: 'read',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory relative to the workspace. Default ".".' },
        depth: { type: 'number', description: 'Recursion depth, 1–3. Default 2.' },
      },
    },
    preview: async (input) => ({ summary: `List ${stringArg(input, 'path', '.')}` }),
    async run(input, ctx): Promise<ToolResultPayload> {
      const display = stringArg(input, 'path', '.');
      const absolute = resolveInside(ctx.workspace, display);
      const depth = Math.min(3, Math.max(1, Math.floor(numberArg(input, 'depth', 2))));
      const limit = 300;
      const lines: string[] = [];
      let truncated = false;

      const walk = async (dir: string, prefix: string, level: number): Promise<void> => {
        if (level > depth || truncated) return;
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          lines.push(`${prefix}(unreadable)`);
          return;
        }
        entries.sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        for (const entry of entries) {
          if (lines.length >= limit) {
            truncated = true;
            return;
          }
          if (shouldIgnore(entry.name)) continue;
          if (entry.isDirectory()) {
            lines.push(`${prefix}${entry.name}/`);
            await walk(path.join(dir, entry.name), `${prefix}  `, level + 1);
          } else {
            lines.push(`${prefix}${entry.name}`);
          }
        }
      };

      await walk(absolute, '', 1);
      if (lines.length === 0) return { content: `${display} is empty.` };
      const header = display === '.' ? `${path.basename(ctx.workspace)}/` : `${display}/`;
      const body = lines.join('\n');
      return {
        content: `${header}\n${body}${truncated ? `\n… listing truncated at ${limit} entries. Use glob or a deeper path.` : ''}`,
        metadata: { path: display, entries: lines.length, truncated },
      };
    },
  };

  const globTool: ToolDefinition = {
    name: 'glob',
    description:
      'Find files by glob pattern, e.g. "src/**/*.ts" or "**/*test*". Returns workspace-relative paths.',
    readOnly: true,
    category: 'read',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern relative to the workspace.' },
        path: { type: 'string', description: 'Directory to search in. Default ".".' },
      },
      required: ['pattern'],
    },
    preview: async (input) => ({ summary: `Find files matching ${stringArg(input, 'pattern')}` }),
    async run(input, ctx): Promise<ToolResultPayload> {
      const pattern = stringArg(input, 'pattern');
      const root = stringArg(input, 'path', '.');
      const absoluteRoot = resolveInside(ctx.workspace, root);
      let matches: string[];
      try {
        matches = await fg(pattern, {
          cwd: absoluteRoot,
          ignore: IGNORE,
          dot: false,
          onlyFiles: true,
          followSymbolicLinks: false,
          unique: true,
        });
      } catch (error) {
        return { content: `Invalid glob pattern: ${(error as Error).message}`, isError: true };
      }
      matches.sort();
      const limited = matches.slice(0, 200);
      const relRoot = relativeDisplay(ctx.workspace, absoluteRoot);
      const displayed = limited.map((match) =>
        relRoot === '.' ? match : `${relRoot}/${match}`,
      );
      if (displayed.length === 0) return { content: `No files matched "${pattern}".` };
      return {
        content: `${displayed.join('\n')}${matches.length > limited.length ? `\n… ${matches.length - limited.length} more matches.` : ''}`,
        metadata: { count: matches.length },
      };
    },
  };

  const grepTool: ToolDefinition = {
    name: 'grep',
    description:
      'Search file contents with a regular expression. Returns "path:line: text". Use this before reading files.',
    readOnly: true,
    category: 'read',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression (ripgrep syntax).' },
        glob: { type: 'string', description: 'Optional file glob, e.g. "*.ts" or "src/**".' },
        path: { type: 'string', description: 'Directory to search. Default ".".' },
        case_sensitive: { type: 'boolean', description: 'Default false.' },
        max_results: { type: 'number', description: 'Default 80, max 300.' },
      },
      required: ['pattern'],
    },
    preview: async (input) => ({ summary: `Search for /${stringArg(input, 'pattern')}/` }),
    async run(input, ctx): Promise<ToolResultPayload> {
      const pattern = stringArg(input, 'pattern');
      const glob = typeof input.glob === 'string' ? input.glob : undefined;
      const root = stringArg(input, 'path', '.');
      const absoluteRoot = resolveInside(ctx.workspace, root);
      const caseSensitive = boolArg(input, 'case_sensitive', false);
      const maxResults = Math.min(300, Math.max(1, Math.floor(numberArg(input, 'max_results', 80))));

      try {
        new RegExp(pattern);
      } catch (error) {
        return { content: `Invalid regular expression: ${(error as Error).message}`, isError: true };
      }

      if (await hasRipgrep()) {
        const args = ['--line-number', '--no-heading', '--color', 'never', '--max-columns', '400', '--max-count', '20'];
        if (!caseSensitive) args.push('--ignore-case');
        if (glob) args.push('-g', glob);
        args.push('--', pattern);
        try {
          const { stdout } = await execFileAsync('rg', args, {
            cwd: absoluteRoot,
            maxBuffer: 12 * 1024 * 1024,
            timeout: 20_000,
          });
          return formatGrep(stdout, maxResults, relativeDisplay(ctx.workspace, absoluteRoot));
        } catch (error) {
          const failure = error as { code?: number; stdout?: string; message?: string };
          if (failure.code === 1) return { content: `No matches for /${pattern}/.` };
          if (typeof failure.stdout === 'string' && failure.stdout.length > 0) {
            return formatGrep(failure.stdout, maxResults, relativeDisplay(ctx.workspace, absoluteRoot));
          }
          // Fall through to the JS implementation on unusual ripgrep failures.
        }
      }

      return jsGrep(absoluteRoot, pattern, glob, caseSensitive, maxResults);
    },
  };

  return [readFile, listDir, globTool, grepTool];
}

export function createWriteTools(): ToolDefinition[] {
  const writeFile: ToolDefinition = {
    name: 'write_file',
    description:
      'Create or completely overwrite a file. Prefer edit_file for small changes. Parent directories are created automatically.',
    readOnly: false,
    category: 'write',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the workspace root.' },
        content: { type: 'string', description: 'Full file contents.' },
      },
      required: ['path', 'content'],
    },
    async preview(input, ctx) {
      const display = stringArg(input, 'path');
      const content = stringArg(input, 'content');
      const absolute = resolveInside(ctx.workspace, display);
      let oldContent: string | null = null;
      try {
        oldContent = await readTextFile(absolute);
      } catch {
        oldContent = null;
      }
      const change = await changeSummary(absolute, display, oldContent, content);
      return { summary: change.summary, diff: change.diff };
    },
    async run(input, ctx): Promise<ToolResultPayload> {
      const display = stringArg(input, 'path');
      const content = stringArg(input, 'content');
      if (content.length > 5_000_000) {
        return { content: 'Refusing to write more than 5MB in one call.', isError: true };
      }
      const absolute = resolveInside(ctx.workspace, display);
      let oldContent: string | null = null;
      try {
        oldContent = await readTextFile(absolute);
      } catch {
        oldContent = null;
      }
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, content, 'utf8');
      const change = await changeSummary(absolute, display, oldContent, content);
      return {
        content: `${oldContent === null ? 'Created' : 'Updated'} ${display} (+${change.added} −${change.removed}, ${content.split('\n').length} lines).`,
        metadata: { path: display, diff: change.diff, added: change.added, removed: change.removed, created: oldContent === null },
      };
    },
  };

  const editFile: ToolDefinition = {
    name: 'edit_file',
    description:
      'Replace an exact string in a file. old_string must match exactly (including indentation) and be unique unless replace_all is true. Read the file first.',
    readOnly: false,
    category: 'write',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the workspace root.' },
        old_string: { type: 'string', description: 'Exact text to replace.' },
        new_string: { type: 'string', description: 'Replacement text.' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence. Default false.' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    async preview(input, ctx) {
      const display = stringArg(input, 'path');
      const oldString = stringArg(input, 'old_string');
      const newString = stringArg(input, 'new_string');
      const replaceAll = boolArg(input, 'replace_all', false);
      const absolute = resolveInside(ctx.workspace, display);
      const current = await readForEdit(absolute, display);
      const updated = applyEdit(current, oldString, newString, replaceAll);
      const change = await changeSummary(absolute, display, current, updated);
      return { summary: change.summary, diff: change.diff };
    },
    async run(input, ctx): Promise<ToolResultPayload> {
      const display = stringArg(input, 'path');
      const oldString = stringArg(input, 'old_string');
      const newString = stringArg(input, 'new_string');
      const replaceAll = boolArg(input, 'replace_all', false);
      if (oldString === newString) {
        return { content: 'old_string and new_string are identical; nothing to do.', isError: true };
      }
      const absolute = resolveInside(ctx.workspace, display);
      const current = await readForEdit(absolute, display);
      const updated = applyEdit(current, oldString, newString, replaceAll);
      await fs.writeFile(absolute, updated, 'utf8');
      const change = await changeSummary(absolute, display, current, updated);
      return {
        content: `Updated ${display} (+${change.added} −${change.removed}).`,
        metadata: { path: display, diff: change.diff, added: change.added, removed: change.removed },
      };
    },
  };

  return [writeFile, editFile];
}

function applyEdit(current: string, oldString: string, newString: string, replaceAll: boolean): string {
  if (oldString.length === 0) {
    throw new CodedError('old_string must not be empty.', 'tool');
  }
  const count = current.split(oldString).length - 1;
  if (count === 0) {
    throw new CodedError(
      'old_string was not found in the file. Re-read the file and copy the exact text, including whitespace.',
      'tool',
    );
  }
  if (count > 1 && !replaceAll) {
    throw new CodedError(
      `old_string appears ${count} times. Add more surrounding context to make it unique, or set replace_all=true.`,
      'tool',
    );
  }
  return replaceAll ? current.split(oldString).join(newString) : current.replace(oldString, newString);
}

function shouldIgnore(name: string): boolean {
  return (
    name === 'node_modules' ||
    name === '.git' ||
    name === 'dist' ||
    name === 'build' ||
    name === 'out' ||
    name === '.next' ||
    name === 'coverage' ||
    name === '.DS_Store' ||
    name === '__pycache__' ||
    name === '.venv'
  );
}

async function hasRipgrep(): Promise<boolean> {
  try {
    await execFileAsync('rg', ['--version'], { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

function formatGrep(stdout: string, maxResults: number, relRoot: string): ToolResultPayload {
  const lines = stdout.trim().split('\n').filter(Boolean);
  const sliced = lines.slice(0, maxResults).map((line) => {
    if (relRoot === '.') return line;
    return line.startsWith('/') ? line : line;
  });
  if (sliced.length === 0) return { content: 'No matches.' };
  return {
    content: `${sliced.join('\n')}${lines.length > sliced.length ? `\n… ${lines.length - sliced.length} more matches.` : ''}`,
    metadata: { count: lines.length },
  };
}

async function jsGrep(
  root: string,
  pattern: string,
  glob: string | undefined,
  caseSensitive: boolean,
  maxResults: number,
): Promise<ToolResultPayload> {
  const files = await fg(glob ?? '**/*', {
    cwd: root,
    ignore: IGNORE,
    onlyFiles: true,
    dot: false,
    followSymbolicLinks: false,
  });
  const regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
  const results: string[] = [];
  let scanned = 0;

  for (const file of files.slice(0, 4000)) {
    if (results.length >= maxResults) break;
    const absolute = path.join(root, file);
    if (!isInside(root, absolute)) continue;
    let stat;
    try {
      stat = await fs.stat(absolute);
    } catch {
      continue;
    }
    if (stat.size > 1_000_000) continue;
    let text: string;
    try {
      text = await readTextFile(absolute);
    } catch {
      continue;
    }
    scanned += 1;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length && results.length < maxResults; i += 1) {
      const line = lines[i]!;
      if (line.length > 1000) continue;
      regex.lastIndex = 0;
      if (regex.test(line)) {
        results.push(`${file}:${i + 1}: ${line.trim().slice(0, 300)}`);
      }
    }
  }

  if (results.length === 0) return { content: `No matches for /${pattern}/ in ${scanned} files.` };
  return {
    content: results.join('\n') + (results.length >= maxResults ? `\n… stopped at ${maxResults} matches.` : ''),
    metadata: { count: results.length, scanned },
  };
}
