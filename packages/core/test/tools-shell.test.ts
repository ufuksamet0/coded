import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createShellTools } from '../src/tools/shell.js';

function makeCtx(workspace: string) {
  return { workspace, config: {} } as never;
}

function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coded-shell-'));
  return dir;
}

describe('run_command hardening', () => {
  it('schema requires command, exposes timeout knob', () => {
    const [tool] = createShellTools({});
    expect(tool!.name).toBe('run_command');
    expect(tool!.readOnly).toBe(false);
    expect(tool!.parameters.required).toContain('command');
  });

  it('preview warns on dangerous commands', async () => {
    const [tool] = createShellTools({});
    const ws = makeWorkspace();
    const ctx = makeCtx(ws);
    const bad = await tool!.preview!({ command: 'sudo rm -rf /tmp/x' }, ctx);
    expect(bad.warning).toMatch(/elevated|deletes/i);
    const ok = await tool!.preview!({ command: 'echo hi' }, ctx);
    expect(ok.warning).toBeUndefined();
    expect(ok.summary).toMatch(/echo hi/);
  });

  it('runs echo and returns exit 0', async () => {
    const [tool] = createShellTools({});
    const ws = makeWorkspace();
    const res = await tool!.run({ command: 'echo coded-ok' }, makeCtx(ws));
    expect(res.isError).toBeFalsy();
    expect(res.content).toMatch(/coded-ok/);
    expect(res.metadata?.exitCode).toBe(0);
  });

  it('rejects empty command and workspace escape', async () => {
    const [tool] = createShellTools({});
    const ws = makeWorkspace();
    const empty = await tool!.run({ command: '   ' }, makeCtx(ws));
    expect(empty.isError).toBe(true);
    const escape = await tool!.run({ command: 'echo hi', cwd: '../outside-root' }, makeCtx(ws));
    // escapes workspace -> rejected as isError, not a throw
    expect(escape.isError).toBe(true);
  });

  it('times out long-running commands', async () => {
    const [tool] = createShellTools({ defaultTimeoutMs: 300 });
    const ws = makeWorkspace();
    const res = await tool!.run({ command: 'sleep 5', timeout_ms: 300 }, makeCtx(ws));
    expect(res.isError).toBe(true);
    expect(res.metadata?.timedOut).toBe(true);
  }, 15000);
});
