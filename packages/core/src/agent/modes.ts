import type { ModeDefinition } from '../types.js';
import type { CodedConfig } from '../config.js';

const BUILD_PROMPT = `You are in **Build** mode. You have full access to the workspace and can create, edit and delete files. Work autonomously:

- Investigate before changing anything. Read the relevant files, not just the ones named by the user.
- Make the smallest correct change. Match the existing style, naming and libraries.
- Prefer \`edit_file\` for surgical changes and \`write_file\` for new files or full rewrites.
- After a change, verify it when a cheap check exists (typecheck, lint, tests, run the program).
- Do not add dependencies, config files or abstractions unless the task requires them.
- Never commit, push, or open pull requests unless the user explicitly asks.
- If a command needs approval, explain what it does and why in one sentence before calling it.`;

const PLAN_PROMPT = `You are in **Plan** mode, a read-only mode. You can read, search and inspect the workspace, but you cannot modify files.

- Your job is to understand the code and produce a concrete, actionable plan.
- Do not attempt to write or edit files. If the user asks for a change, describe the exact files, functions and edits you would make.
- You may run commands only to inspect the project (git status, ls, tests that only read). Ask before every command.
- End with a short numbered plan and call out risks, unknowns and the files that will be touched.
- When the user is ready to implement, tell them to switch to Build mode (\`/mode build\` or Tab).`;

export const BUILTIN_MODES: Record<string, ModeDefinition> = {
  build: {
    id: 'build',
    name: 'Build',
    description: 'Full agent: reads, writes and runs commands',
    prompt: BUILD_PROMPT,
    tools: '*',
    permissions: { read: 'allow', write: 'allow', shell: 'ask', network: 'allow' },
    autoAllow: ['read_file', 'list_dir', 'glob', 'grep'],
  },
  plan: {
    id: 'plan',
    name: 'Plan',
    description: 'Read-only analysis; asks before commands',
    prompt: PLAN_PROMPT,
    tools: ['read_file', 'list_dir', 'glob', 'grep', 'run_command'],
    permissions: { read: 'allow', write: 'deny', shell: 'ask', network: 'deny' },
    autoAllow: ['read_file', 'list_dir', 'glob', 'grep'],
  },
};

export const DEFAULT_MODE = 'build';

export function listModes(config: CodedConfig): ModeDefinition[] {
  const custom = Object.entries(config.modes ?? {}).map(([id, mode]) => ({
    id,
    name: mode.name,
    description: mode.description ?? '',
    prompt: mode.prompt ?? '',
    tools: mode.tools ?? '*',
    permissions: {
      read: mode.permissions?.read ?? 'allow',
      write: mode.permissions?.write ?? 'ask',
      shell: mode.permissions?.shell ?? 'ask',
      network: mode.permissions?.network ?? 'ask',
    },
    autoAllow: mode.autoAllow,
  }));

  const merged = new Map<string, ModeDefinition>();
  for (const mode of Object.values(BUILTIN_MODES)) merged.set(mode.id, mode);
  for (const mode of custom) merged.set(mode.id, mode);
  return [...merged.values()];
}

export function getMode(config: CodedConfig, id: string | undefined): ModeDefinition {
  const modes = listModes(config);
  const found = modes.find((mode) => mode.id === id);
  return found ?? BUILTIN_MODES[DEFAULT_MODE]!;
}
