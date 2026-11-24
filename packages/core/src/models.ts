import type { ProviderConfig } from './config.js';

export interface ModelInfo {
  id: string;
  provider: string;
  label: string;
  contextWindow: number;
  maxOutput?: number;
  /** Models that are good at tool use and agentic editing. */
  recommended?: boolean;
  /** Local models usually run on the user's machine. */
  local?: boolean;
}

/**
 * A curated catalog for the picker. Arbitrary model ids are still accepted —
 * this only powers discovery and context-budget defaults.
 */
export const MODEL_CATALOG: ModelInfo[] = [
  // Anthropic
  { id: 'claude-opus-4-1', provider: 'anthropic', label: 'Claude Opus 4.1', contextWindow: 200_000, maxOutput: 32_000, recommended: true },
  { id: 'claude-sonnet-4-5', provider: 'anthropic', label: 'Claude Sonnet 4.5', contextWindow: 200_000, maxOutput: 32_000, recommended: true },
  { id: 'claude-haiku-4-5', provider: 'anthropic', label: 'Claude Haiku 4.5', contextWindow: 200_000, maxOutput: 16_000 },
  { id: 'claude-3-7-sonnet-latest', provider: 'anthropic', label: 'Claude 3.7 Sonnet', contextWindow: 200_000, maxOutput: 16_000 },
  { id: 'claude-3-5-haiku-latest', provider: 'anthropic', label: 'Claude 3.5 Haiku', contextWindow: 200_000, maxOutput: 8_192 },

  // OpenAI
  { id: 'gpt-5', provider: 'openai', label: 'GPT-5', contextWindow: 400_000, maxOutput: 32_000, recommended: true },
  { id: 'gpt-5-mini', provider: 'openai', label: 'GPT-5 mini', contextWindow: 400_000, maxOutput: 16_000 },
  { id: 'gpt-4.1', provider: 'openai', label: 'GPT-4.1', contextWindow: 1_000_000, maxOutput: 32_000, recommended: true },
  { id: 'gpt-4.1-mini', provider: 'openai', label: 'GPT-4.1 mini', contextWindow: 1_000_000, maxOutput: 16_000 },
  { id: 'o4-mini', provider: 'openai', label: 'o4-mini', contextWindow: 200_000, maxOutput: 16_000 },
  { id: 'gpt-4o', provider: 'openai', label: 'GPT-4o', contextWindow: 128_000, maxOutput: 16_384 },

  // Google
  { id: 'gemini-2.5-pro', provider: 'google', label: 'Gemini 2.5 Pro', contextWindow: 1_000_000, maxOutput: 32_000, recommended: true },
  { id: 'gemini-2.5-flash', provider: 'google', label: 'Gemini 2.5 Flash', contextWindow: 1_000_000, maxOutput: 16_000 },
  { id: 'gemini-2.0-flash', provider: 'google', label: 'Gemini 2.0 Flash', contextWindow: 1_000_000, maxOutput: 8_192 },

  // Local (served through an OpenAI-compatible endpoint such as Ollama)
  { id: 'qwen2.5-coder:32b', provider: 'local', label: 'Qwen2.5 Coder 32B', contextWindow: 32_768, local: true },
  { id: 'qwen2.5-coder:7b', provider: 'local', label: 'Qwen2.5 Coder 7B', contextWindow: 32_768, local: true },
  { id: 'llama3.3:70b', provider: 'local', label: 'Llama 3.3 70B', contextWindow: 131_072, local: true },
  { id: 'deepseek-coder-v2:16b', provider: 'local', label: 'DeepSeek Coder V2 16B', contextWindow: 131_072, local: true },
];

export interface ParsedModelRef {
  provider: string;
  model: string;
}

export function parseModelRef(ref: string): ParsedModelRef {
  const trimmed = ref.trim();
  const slash = trimmed.indexOf('/');
  if (slash > 0) {
    return { provider: trimmed.slice(0, slash), model: trimmed.slice(slash + 1) };
  }
  // Friendly inference for bare model ids.
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('claude')) return { provider: 'anthropic', model: trimmed };
  if (lower.startsWith('gpt') || lower.startsWith('o1') || lower.startsWith('o3') || lower.startsWith('o4')) {
    return { provider: 'openai', model: trimmed };
  }
  if (lower.startsWith('gemini')) return { provider: 'google', model: trimmed };
  return { provider: 'local', model: trimmed };
}

export function findModel(provider: string, model: string): ModelInfo | undefined {
  return MODEL_CATALOG.find((m) => m.provider === provider && m.id === model);
}

export function contextWindowFor(provider: string, model: string, configured: Record<string, ProviderConfig>): number {
  return findModel(provider, model)?.contextWindow ?? (configured[provider]?.contextWindow as number | undefined) ?? 128_000;
}

export function listModels(providers: Record<string, ProviderConfig>): ModelInfo[] {
  const extra: ModelInfo[] = [];
  for (const [provider, config] of Object.entries(providers)) {
    for (const id of config.models ?? []) {
      if (!findModel(provider, id)) {
        extra.push({ id, provider, label: id, contextWindow: config.contextWindow ?? 128_000 });
      }
    }
  }
  return [...MODEL_CATALOG, ...extra];
}
