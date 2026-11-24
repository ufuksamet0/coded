import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ModeDefinition } from '../types.js';
import { truncate } from '../utils/text.js';

const execFileAsync = promisify(execFile);

const INSTRUCTION_FILES = ['CODED.md', 'AGENTS.md', 'CLAUDE.md', '.coded/instructions.md'];

export interface PromptOptions {
  workspace: string;
  mode: ModeDefinition;
  model: string;
  provider: string;
  /** Extra user-provided instructions (e.g. from the desktop settings). */
  extraInstructions?: string;
}

export async function buildSystemPrompt(options: PromptOptions): Promise<string> {
  const { workspace, mode } = options;
  const [instructions, git, files] = await Promise.all([
    readProjectInstructions(workspace),
    gitContext(workspace),
    topLevelEntries(workspace),
  ]);

  const sections: string[] = [];

  sections.push(`You are **Coded**, an AI coding agent running on the user's machine. You help with real software engineering tasks: explaining code, finding bugs, implementing features, refactoring, running tests and commands.

You are not a chatbot that describes code — you are an agent with tools. When a task requires inspecting or changing the workspace, use the tools instead of guessing.`);

  sections.push(`# Environment
- Workspace: \`${workspace}\`
- Platform: ${os.platform()} ${os.arch()} (${os.release()})
- Shell: ${process.env.SHELL ?? 'unknown'}
- Date: ${new Date().toISOString().slice(0, 10)}
- Model: \`${options.provider}/${options.model}\`
- Mode: **${mode.name}** — ${mode.description}
${git ? `- Git: ${git}` : '- Git: not a repository'}
- Top-level entries: ${files.length > 0 ? files.join(', ') : '(empty workspace)'}`);

  sections.push(`# How you work
1. **Understand first.** Read files and search the codebase before proposing or making changes. Never invent file contents or APIs.
2. **Be surgical.** Change only what the task needs. Preserve the project's style, structure and dependencies.
3. **Verify.** Run the cheapest meaningful check after a change (typecheck, unit test, lint, or the program itself). Report failures honestly.
4. **Communicate briefly.** The user sees a terminal. Use short paragraphs, bullets and fenced code blocks. Do not repeat file contents back to the user.
5. **Stay safe.** Never print secrets, tokens or private keys. Do not run destructive commands (rm -rf, force-push, database drops) without explicit approval. Never commit or push unless asked.
6. **Ask when blocked.** If requirements are genuinely ambiguous, ask one focused question. Otherwise make a reasonable assumption and state it.
7. **Finish the job.** Do not stop after a plan when you are in Build mode. Implement, verify, and summarise what changed.`);

  sections.push(`# Tool use
- Paths are relative to the workspace root. Use \`read_file\` before editing a file you have not seen.
- \`edit_file\` replaces an exact \`old_string\`. Include enough surrounding context to make it unique. If it fails, re-read the file and retry.
- \`write_file\` replaces the whole file. Use it for new files or deliberate rewrites.
- \`run_command\` runs in the workspace with a timeout. Prefer non-interactive commands. Never start long-running servers unless asked.
- You may call multiple independent read-only tools in one turn.
- Tool output may be truncated. Use offsets or narrower searches instead of re-reading huge files.`);

  if (instructions) {
    sections.push(`# Project instructions
The repository contains instructions for coding agents. Follow them unless they conflict with the user's request.

${instructions}`);
  }

  sections.push(`# Mode
${mode.prompt}`);

  if (options.extraInstructions?.trim()) {
    sections.push(`# User instructions
${options.extraInstructions.trim()}`);
  }

  return sections.join('\n\n');
}

export async function readProjectInstructions(workspace: string): Promise<string> {
  const parts: string[] = [];
  for (const name of INSTRUCTION_FILES) {
    try {
      const content = await fs.readFile(path.join(workspace, name), 'utf8');
      if (content.trim()) {
        parts.push(`## ${name}\n${truncate(content.trim(), 8000, 'instructions truncated')}`);
      }
    } catch {
      // Missing files are expected.
    }
  }
  return parts.join('\n\n');
}

async function gitContext(workspace: string): Promise<string | undefined> {
  try {
    const { stdout: branch } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: workspace,
      timeout: 2000,
    });
    let status = '';
    try {
      const result = await execFileAsync('git', ['status', '--short', '--branch'], {
        cwd: workspace,
        timeout: 2000,
      });
      status = result.stdout.trim().split('\n').slice(0, 20).join(' | ');
    } catch {
      // Ignore.
    }
    return `${branch.trim()}${status ? ` — ${status}` : ''}`;
  } catch {
    return undefined;
  }
}

async function topLevelEntries(workspace: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(workspace, { withFileTypes: true });
    return entries
      .filter((entry) => !entry.name.startsWith('.') || entry.name === '.env.example')
      .filter((entry) => entry.name !== 'node_modules')
      .slice(0, 40)
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
  } catch {
    return [];
  }
}
