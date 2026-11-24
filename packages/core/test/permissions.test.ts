import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { PermissionEngine } from '../src/permissions.js';
import { getMode } from '../src/agent/modes.js';
import type { ToolDefinition } from '../src/types.js';

const workspace = '/tmp/coded-permissions';
const config = loadConfig({ workspace, skipFiles: true });

function tool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'write_file',
    description: 'test',
    parameters: {},
    readOnly: false,
    category: 'write',
    run: async () => ({ content: 'ok' }),
    ...overrides,
  };
}

describe('PermissionEngine', () => {
  it('allows read tools automatically in build mode', async () => {
    const engine = new PermissionEngine({ mode: getMode(config, 'build'), config });
    const result = await engine.authorize(tool({ name: 'read_file', category: 'read', readOnly: true }), {}, { workspace });
    expect(result.allowed).toBe(true);
  });

  it('allows writes automatically in build mode', async () => {
    const engine = new PermissionEngine({ mode: getMode(config, 'build'), config });
    const result = await engine.authorize(tool(), {}, { workspace });
    expect(result.allowed).toBe(true);
  });

  it('denies writes in plan mode', async () => {
    const engine = new PermissionEngine({ mode: getMode(config, 'plan'), config });
    const result = await engine.authorize(tool(), {}, { workspace });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('read-only');
  });

  it('asks for shell commands and remembers "always"', async () => {
    const confirm = vi.fn().mockResolvedValue('always');
    const engine = new PermissionEngine({
      mode: getMode(config, 'build'),
      config,
      confirm,
    });
    const shell = tool({ name: 'run_command', category: 'shell' });

    expect((await engine.authorize(shell, { command: 'ls' }, { workspace })).allowed).toBe(true);
    expect((await engine.authorize(shell, { command: 'pwd' }, { workspace })).allowed).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('respects config deny rules', async () => {
    const denied = loadConfig({
      workspace,
      skipFiles: true,
      overrides: { permissions: { deny: ['write_file'] } },
    });
    const engine = new PermissionEngine({ mode: getMode(denied, 'build'), config: denied });
    const result = await engine.authorize(tool(), {}, { workspace });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('denies');
  });

  it('supports yolo mode without a confirm callback', async () => {
    const engine = new PermissionEngine({ mode: getMode(config, 'build'), config, yolo: true });
    const result = await engine.authorize(tool({ name: 'run_command', category: 'shell' }), { command: 'ls' }, { workspace });
    expect(result.allowed).toBe(true);
  });

  it('denies when approval is needed but no UI is attached', async () => {
    const engine = new PermissionEngine({ mode: getMode(config, 'build'), config });
    const result = await engine.authorize(
      tool({ name: 'run_command', category: 'shell' }),
      { command: 'ls' },
      { workspace },
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('--yes');
  });

  it('exposes a diff preview for file writes', async () => {
    const engine = new PermissionEngine({
      mode: getMode(config, 'build'),
      config,
      confirm: async (request) => {
        expect(request.summary).toContain('Create');
        expect(request.diff).toContain('+hello');
        return 'deny';
      },
    });
    const write = tool({
      preview: async () => ({ summary: 'Create a.txt (+1 −0)', diff: '+++ b/a.txt\n+hello' }),
    });
    await engine.authorize(write, {}, { workspace });
  });
});
