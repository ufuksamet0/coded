import { spawn } from 'node:child_process';
import path from 'node:path';
import type { ToolDefinition, ToolResultPayload } from '../types.js';
import { CodedError } from '../errors.js';
import { resolveInside, relativeDisplay } from '../utils/paths.js';
import { formatDuration, truncateMiddle } from '../utils/text.js';

const MAX_STREAM = 300_000;

const DANGEROUS = [
  { pattern: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+/i, label: 'deletes files recursively' },
  { pattern: /\bsudo\b/i, label: 'runs with elevated privileges' },
  { pattern: /\bmkfs(\.|\s)/i, label: 'formats a filesystem' },
  { pattern: /\bdd\s+if=/i, label: 'writes raw disk data' },
  { pattern: /\bgit\s+(push|reset\s+--hard|clean\s+-[a-zA-Z]*f)/i, label: 'rewrites or publishes git history' },
  { pattern: /\bnpm\s+publish\b|\bpnpm\s+publish\b|\byarn\s+publish\b/i, label: 'publishes a package' },
  { pattern: /\bdrop\s+(database|table|schema)\b/i, label: 'drops database objects' },
  { pattern: /:\s*\(\s*\)\s*\{/i, label: 'contains a fork bomb' },
  { pattern: />\s*\/dev\/(sd|disk)/i, label: 'writes directly to a disk device' },
  { pattern: /\bshutdown\b|\breboot\b/i, label: 'restarts the machine' },
];

export interface ShellToolOptions {
  defaultTimeoutMs: number;
}

export function createShellTools(options: ShellToolOptions): ToolDefinition[] {
  const runCommand: ToolDefinition = {
    name: 'run_command',
    description:
      'Run a shell command in the workspace and return stdout, stderr and the exit code. Commands are non-interactive and time out. Use for builds, tests, git inspection and scripts.',
    readOnly: false,
    category: 'shell',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to run.' },
        cwd: { type: 'string', description: 'Working directory relative to the workspace. Default ".".' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds. Default 120000, max 600000.' },
      },
      required: ['command'],
    },
    async preview(input, ctx) {
      const command = String(input.command ?? '');
      const cwd = typeof input.cwd === 'string' ? input.cwd : '.';
      const warning = DANGEROUS.find((entry) => entry.pattern.test(command))?.label;
      return {
        summary: `Run: ${command}`,
        ...(cwd !== '.' ? { reason: `in ${relativeDisplay(ctx.workspace, resolveInside(ctx.workspace, cwd))}` } : {}),
        ...(warning ? { warning: `This command ${warning}. Review it carefully.` } : {}),
      };
    },
    async run(input, ctx): Promise<ToolResultPayload> {
      const command = typeof input.command === 'string' ? input.command.trim() : '';
      if (!command) return { content: 'No command provided.', isError: true };
      const cwdInput = typeof input.cwd === 'string' && input.cwd ? input.cwd : '.';
      const cwd = resolveInside(ctx.workspace, cwdInput);
      const timeoutMs = Math.min(
        600_000,
        Math.max(1_000, typeof input.timeout_ms === 'number' ? input.timeout_ms : options.defaultTimeoutMs),
      );

      const started = Date.now();
      const result = await execute(command, cwd, timeoutMs, ctx.signal);
      const duration = Date.now() - started;

      const parts: string[] = [`$ ${command}`, `exit code: ${result.code ?? 'none'} (${formatDuration(duration)})`];
      if (result.timedOut) parts.push(`timed out after ${formatDuration(timeoutMs)}`);
      if (result.aborted) parts.push('aborted');
      const output = combineOutput(result.stdout, result.stderr);
      if (output.trim()) parts.push('', output.trimEnd());

      return {
        content: truncateMiddle(parts.join('\n'), 60_000, 'output truncated'),
        isError: result.code !== 0 || result.timedOut,
        metadata: {
          exitCode: result.code,
          durationMs: duration,
          timedOut: result.timedOut,
          cwd: relativeDisplay(ctx.workspace, cwd),
        },
      };
    },
  };

  return [runCommand];
}

interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
}

function execute(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const shell = isWindows
      ? process.env.ComSpec ?? 'cmd.exe'
      : process.env.SHELL ?? '/bin/bash';
    const args = isWindows ? ['/d', '/s', '/c', command] : ['-lc', command];

    let child;
    try {
      child = spawn(shell, args, {
        cwd,
        env: {
          ...process.env,
          NO_COLOR: '1',
          FORCE_COLOR: '0',
          GIT_PAGER: 'cat',
          PAGER: 'cat',
          CODED: '1',
        },
        detached: !isWindows,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({
        code: null,
        stdout: '',
        stderr: `Failed to start command: ${(error as Error).message}`,
        timedOut: false,
        aborted: false,
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const append = (current: string, chunk: Buffer): string => {
      if (current.length >= MAX_STREAM) return current;
      return current + chunk.toString('utf8');
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });

    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ code, stdout, stderr, timedOut, aborted });
    };

    const killTree = (): void => {
      if (child.pid === undefined) return;
      try {
        if (isWindows) {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
          process.kill(-child.pid, 'SIGKILL');
        }
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          // already gone
        }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, timeoutMs);

    const onAbort = (): void => {
      aborted = true;
      killTree();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();

    child.on('error', (error) => {
      stderr += `\nFailed to run command: ${error.message}`;
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });
}

function combineOutput(stdout: string, stderr: string): string {
  if (!stdout && !stderr) return '';
  if (!stdout) return stderr;
  if (!stderr) return stdout;
  return `${stdout}\n${stderr}`;
}

export function assertWorkspaceDirectory(workspace: string): void {
  if (!path.isAbsolute(workspace)) {
    throw new CodedError(`Workspace must be an absolute path, got "${workspace}".`, 'config');
  }
}
