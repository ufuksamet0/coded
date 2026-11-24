import fs from 'node:fs';
import path from 'node:path';
import { configDir, expandHome } from '@coded/core';

export interface ProviderSetup {
  apiKey?: string;
  baseURL?: string;
  type?: 'openai' | 'anthropic' | 'google';
}

export function globalConfigPath(): string {
  return path.join(configDir(), 'config.json');
}

export function readGlobalConfig(): Record<string, unknown> {
  const file = globalConfigPath();
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function writeGlobalConfig(config: Record<string, unknown>): string {
  const file = globalConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Best effort on platforms without POSIX modes.
  }
  return file;
}

export function saveProvider(providerId: string, setup: ProviderSetup): string {
  const config = readGlobalConfig();
  const providers = (config.providers as Record<string, Record<string, unknown>> | undefined) ?? {};
  const existing = providers[providerId] ?? {};
  providers[providerId] = {
    ...existing,
    ...(setup.apiKey ? { apiKey: setup.apiKey } : {}),
    ...(setup.baseURL ? { baseURL: setup.baseURL } : {}),
    ...(setup.type ? { type: setup.type } : {}),
  };
  config.providers = providers;
  return writeGlobalConfig(config);
}

export function saveDefaultModel(model: string): string {
  const config = readGlobalConfig();
  config.model = model;
  return writeGlobalConfig(config);
}

export function saveTheme(theme: 'dark' | 'light'): string {
  const config = readGlobalConfig();
  const ui = (config.ui as Record<string, unknown> | undefined) ?? {};
  config.ui = { ...ui, theme };
  return writeGlobalConfig(config);
}

export function maskKey(key: string | undefined): string {
  if (!key) return 'not set';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export function initProjectConfig(workspace: string): string {
  const directory = path.join(workspace, '.coded');
  const file = path.join(directory, 'config.json');
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(directory, { recursive: true });
  const template = {
    $schema: 'https://coded.dev/config.schema.json',
    permissions: {
      allow: [],
      deny: [],
    },
    limits: {
      maxSteps: 40,
    },
  };
  fs.writeFileSync(file, `${JSON.stringify(template, null, 2)}\n`, 'utf8');
  return file;
}

export function resolveWorkspace(input: string | undefined): string {
  return path.resolve(expandHome(input ?? process.cwd()));
}
