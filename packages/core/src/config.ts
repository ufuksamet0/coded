import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { CodedError } from './errors.js';
import { configDir, expandHome, normalizeWorkspace } from './utils/paths.js';

export const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-5';

export const providerConfigSchema = z.object({
  /** Wire protocol. Defaults to the provider key when it is a known type. */
  type: z.enum(['openai', 'anthropic', 'google']).optional(),
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  headers: z.record(z.string()).optional(),
  models: z.array(z.string()).optional(),
  contextWindow: z.number().int().positive().optional(),
  /** Disable native tool calling for servers that do not implement it. */
  tools: z.boolean().optional(),
});

export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export const modeSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  prompt: z.string().default(''),
  tools: z.union([z.literal('*'), z.array(z.string())]).default('*'),
  permissions: z
    .object({
      read: z.enum(['allow', 'ask', 'deny']).default('allow'),
      write: z.enum(['allow', 'ask', 'deny']).default('ask'),
      shell: z.enum(['allow', 'ask', 'deny']).default('ask'),
      network: z.enum(['allow', 'ask', 'deny']).default('ask'),
    })
    .default({}),
  autoAllow: z.array(z.string()).optional(),
});

const fileSchema = z.object({
  $schema: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  providers: z.record(providerConfigSchema).optional(),
  modes: z.record(modeSchema).optional(),
  permissions: z
    .object({
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
    })
    .optional(),
  limits: z
    .object({
      maxSteps: z.number().int().positive().optional(),
      maxOutputChars: z.number().int().positive().optional(),
      commandTimeoutMs: z.number().int().positive().optional(),
      contextTokens: z.number().int().positive().optional(),
    })
    .optional(),
  ui: z
    .object({
      theme: z.enum(['dark', 'light', 'auto']).optional(),
      showTokenUsage: z.boolean().optional(),
    })
    .optional(),
});

export type ConfigFile = z.infer<typeof fileSchema>;

export interface CodedConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
  providers: Record<string, ProviderConfig>;
  modes: Record<string, import('./types.js').ModeDefinition> | undefined;
  permissions: { allow: string[]; deny: string[] };
  limits: {
    maxSteps: number;
    maxOutputChars: number;
    commandTimeoutMs: number;
    contextTokens: number;
  };
  ui: { theme: 'dark' | 'light' | 'auto'; showTokenUsage: boolean };
  sources: string[];
}

export const DEFAULT_PROVIDERS: Record<string, ProviderConfig> = {
  openai: {
    type: 'openai',
    apiKey: 'env:OPENAI_API_KEY',
    baseURL: 'env:OPENAI_BASE_URL',
  },
  anthropic: {
    type: 'anthropic',
    apiKey: 'env:ANTHROPIC_API_KEY',
    baseURL: 'env:ANTHROPIC_BASE_URL',
  },
  google: {
    type: 'google',
    apiKey: 'env:GEMINI_API_KEY',
    baseURL: 'env:GOOGLE_GENERATIVE_AI_BASE_URL',
  },
  local: {
    type: 'openai',
    apiKey: 'local',
    baseURL: 'env:OLLAMA_HOST',
  },
};

const DEFAULT_LIMITS = {
  maxSteps: 40,
  maxOutputChars: 60_000,
  commandTimeoutMs: 120_000,
  contextTokens: 128_000,
};

export interface LoadConfigOptions {
  workspace: string;
  /** Extra layers, highest priority last. */
  overrides?: ConfigFile;
  /** Skip reading files (tests). */
  skipFiles?: boolean;
}

export function loadConfig(options: LoadConfigOptions): CodedConfig {
  const workspace = normalizeWorkspace(options.workspace);
  const sources: string[] = [];
  const layers: ConfigFile[] = [];

  if (!options.skipFiles) {
    const globalPath = path.join(configDir(), 'config.json');
    const projectPath = path.join(workspace, '.coded', 'config.json');
    const explicit = process.env.CODED_CONFIG ? path.resolve(expandHome(process.env.CODED_CONFIG)) : undefined;

    for (const file of [globalPath, projectPath, explicit]) {
      if (!file) continue;
      const parsed = readConfigFile(file);
      if (parsed) {
        layers.push(parsed);
        sources.push(file);
      }
    }
  }

  if (options.overrides) layers.push(options.overrides);

  let config: CodedConfig = {
    model: DEFAULT_MODEL,
    providers: { ...DEFAULT_PROVIDERS },
    modes: undefined,
    permissions: { allow: [], deny: [] },
    limits: { ...DEFAULT_LIMITS },
    ui: { theme: 'dark', showTokenUsage: true },
    sources,
  };

  for (const layer of layers) {
    config = mergeConfig(config, layer);
  }

  if (process.env.CODED_MODEL) config.model = process.env.CODED_MODEL;
  if (process.env.CODED_THEME === 'light' || process.env.CODED_THEME === 'dark') {
    config.ui.theme = process.env.CODED_THEME;
  }

  config.providers = normalizeProviders(config.providers);
  return config;
}

function readConfigFile(file: string): ConfigFile | undefined {
  if (!fs.existsSync(file)) return undefined;
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new CodedError(`Could not read config at ${file}: ${(error as Error).message}`, 'config', error);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new CodedError(`Invalid JSON in ${file}: ${(error as Error).message}`, 'config', error);
  }
  const result = fileSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('\n  ');
    throw new CodedError(`Invalid config in ${file}:\n  ${issues}`, 'config');
  }
  return result.data;
}

export function mergeConfig(base: CodedConfig, layer: ConfigFile): CodedConfig {
  const providers = { ...base.providers };
  for (const [id, value] of Object.entries(layer.providers ?? {})) {
    providers[id] = { ...providers[id], ...value };
  }

  const modes = layer.modes
    ? { ...(base.modes ?? {}), ...layer.modes }
    : base.modes;

  return {
    model: layer.model ?? base.model,
    temperature: layer.temperature ?? base.temperature,
    maxTokens: layer.maxTokens ?? base.maxTokens,
    providers,
    modes: modes as CodedConfig['modes'],
    permissions: {
      allow: layer.permissions?.allow ?? base.permissions.allow,
      deny: layer.permissions?.deny ?? base.permissions.deny,
    },
    limits: { ...base.limits, ...layer.limits },
    ui: { ...base.ui, ...layer.ui },
    sources: base.sources,
  };
}

/**
 * Fill in sensible defaults for known providers and translate `env:NAME`
 * references. An empty apiKey means "not configured".
 */
export function normalizeProviders(input: Record<string, ProviderConfig>): Record<string, ProviderConfig> {
  const output: Record<string, ProviderConfig> = {};
  for (const [id, raw] of Object.entries(input)) {
    const preset = DEFAULT_PROVIDERS[id] ?? {};
    const config: ProviderConfig = { ...preset, ...raw };
    config.apiKey = resolveSecret(config.apiKey);
    config.baseURL = resolveBaseUrl(config.baseURL, id);
    if (!config.type) {
      config.type = id === 'anthropic' || id === 'google' ? id : 'openai';
    }
    if (!config.baseURL) {
      config.baseURL = defaultBaseUrl(config.type);
    }
    output[id] = config;
  }
  return output;
}

export function resolveSecret(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith('env:')) {
    const resolved = process.env[value.slice(4)];
    return resolved && resolved.length > 0 ? resolved : undefined;
  }
  if (value.startsWith('$')) {
    const resolved = process.env[value.slice(1)];
    return resolved && resolved.length > 0 ? resolved : undefined;
  }
  if (value === 'local') return 'local';
  return value;
}

function resolveBaseUrl(value: string | undefined, provider: string): string | undefined {
  if (!value) return undefined;
  if (value.startsWith('env:')) {
    const env = process.env[value.slice(4)];
    if (env) return env;
    if (provider === 'local') return 'http://127.0.0.1:11434/v1';
    return undefined;
  }
  return value;
}

function defaultBaseUrl(type: string | undefined): string | undefined {
  switch (type) {
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'anthropic':
      return 'https://api.anthropic.com';
    case 'google':
      return 'https://generativelanguage.googleapis.com/v1beta';
    default:
      return undefined;
  }
}

/** Providers that have a usable key (or are local). */
export function configuredProviders(config: CodedConfig): string[] {
  return Object.entries(config.providers)
    .filter(([id, p]) => Boolean(p.apiKey) || id === 'local')
    .map(([id]) => id);
}

export function hasAnyProvider(config: CodedConfig): boolean {
  return configuredProviders(config).some((id) => id !== 'local') || Boolean(config.providers.local?.baseURL);
}

/** Where keys are stored by the desktop app (encrypted with safeStorage). */
export function keysFilePath(): string {
  return path.join(configDir(), 'keys.json');
}

export const configFileTemplate = {
  $schema: 'https://coded.dev/config.schema.json',
  model: DEFAULT_MODEL,
  providers: {
    anthropic: { apiKey: 'env:ANTHROPIC_API_KEY' },
    openai: { apiKey: 'env:OPENAI_API_KEY' },
    google: { apiKey: 'env:GEMINI_API_KEY' },
    local: { baseURL: 'http://127.0.0.1:11434/v1' },
  },
};
