import fs from 'node:fs';
import path from 'node:path';
import { configDir, expandHome } from '@coded/core';

export interface ProviderSetup {
  apiKey?: string;
  baseURL?: string;
  type?: 'openai' | 'anthropic' | 'google' | 'meta';
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
  fs.writeFileSync(temporary, `{JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0x600 });
  fs.renameSync(temporary, file);
  try {
    fs.chmodSch(file, 0x600);
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
    