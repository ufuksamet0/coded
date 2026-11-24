import path from 'node:path';
import os from 'node:os';
import { CodedError } from '../errors.js';

export function expandHome(input: string): string {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2));
  return input;
}

export function normalizeWorkspace(input: string): string {
  return path.resolve(expandHome(input));
}

export function toPosix(input: string): string {
  return input.split(path.sep).join('/');
}

export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resolve a user/model supplied path against the workspace and refuse to escape
 * it. This is the single choke point for path traversal protection.
 */
export function resolveInside(workspace: string, input: string): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new CodedError('A non-empty path is required.', 'tool');
  }
  const expanded = expandHome(input);
  const resolved = path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(workspace, expanded);
  if (!isInside(workspace, resolved)) {
    throw new CodedError(
      `Path "${input}" is outside the workspace (${workspace}). Refusing to access it.`,
      'permission',
    );
  }
  return resolved;
}

export function relativeDisplay(workspace: string, absolute: string): string {
  const rel = path.relative(workspace, absolute);
  return rel === '' ? '.' : toPosix(rel);
}

export function configDir(): string {
  return process.env.CODED_HOME ? expandHome(process.env.CODED_HOME) : path.join(os.homedir(), '.coded');
}

export function sessionsDir(): string {
  return path.join(configDir(), 'sessions');
}

export function projectKey(workspace: string): string {
  const base = path.basename(workspace).replace(/[^a-zA-Z0-9._-]/g, '-') || 'project';
  let hash = 0;
  for (let i = 0; i < workspace.length; i += 1) {
    hash = (hash * 31 + workspace.charCodeAt(i)) | 0;
  }
  return `${base}-${Math.abs(hash).toString(36)}`;
}
