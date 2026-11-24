import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { isInside, resolveInside } from '../src/utils/paths.js';
import { CodedError } from '../src/errors.js';

const workspace = path.join(os.tmpdir(), 'coded-workspace');

describe('path safety', () => {
  it('resolves relative paths inside the workspace', () => {
    expect(resolveInside(workspace, 'src/index.ts')).toBe(path.join(workspace, 'src/index.ts'));
  });

  it('allows the workspace root itself', () => {
    expect(resolveInside(workspace, '.')).toBe(workspace);
  });

  it('rejects parent traversal', () => {
    expect(() => resolveInside(workspace, '../secrets.txt')).toThrow(CodedError);
  });

  it('rejects absolute paths outside the workspace', () => {
    expect(() => resolveInside(workspace, '/etc/passwd')).toThrow(/outside the workspace/);
  });

  it('rejects sibling directories with a shared prefix', () => {
    expect(isInside('/tmp/app', '/tmp/app-evil/file')).toBe(false);
  });
});
