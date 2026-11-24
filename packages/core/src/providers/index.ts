import type { CodedConfig, ProviderConfig } from '../config.js';
import { CodedError } from '../errors.js';
import { contextWindowFor, parseModelRef } from '../models.js';
import type { Provider } from '../types.js';
import { AnthropicProvider } from './anthropic.js';
import { GoogleProvider } from './google.js';
import { OpenAiProvider } from './openai.js';

export { AnthropicProvider } from './anthropic.js';
export { GoogleProvider } from './google.js';
export { OpenAiProvider } from './openai.js';

export function createProvider(
  id: string,
  config: ProviderConfig,
  fetchImpl: typeof fetch = fetch,
): Provider {
  const type = config.type ?? (id === 'anthropic' ? 'anthropic' : id === 'google' ? 'google' : 'openai');
  switch (type) {
    case 'anthropic':
      return new AnthropicProvider(id, config, fetchImpl);
    case 'google':
      return new GoogleProvider(id, config, fetchImpl);
    case 'openai': {
      const baseURL = config.baseURL ?? 'https://api.openai.com/v1';
      const isCloud = /api\.openai\.com|openrouter\.ai|api\.groq\.com|api\.mistral\.ai|api\.together\.xyz|api\.deepseek\.com/.test(
        baseURL,
      );
      if (!config.apiKey && isCloud) {
        throw new CodedError(
          `No API key configured for "${id}". Set OPENAI_API_KEY or add providers.${id}.apiKey to ~/.coded/config.json.`,
          'auth',
        );
      }
      return new OpenAiProvider(id, config, fetchImpl);
    }
    default:
      throw new CodedError(`Unsupported provider type "${String(type)}" for "${id}".`, 'config');
  }
}

export interface ResolvedModel {
  provider: Provider;
  providerId: string;
  model: string;
  contextWindow: number;
}

export class ProviderRegistry {
  private readonly cache = new Map<string, Provider>();

  constructor(
    private readonly config: CodedConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get(providerId: string): Provider {
    const cached = this.cache.get(providerId);
    if (cached) return cached;
    const config = this.config.providers[providerId];
    if (!config) {
      const available = Object.keys(this.config.providers).join(', ');
      throw new CodedError(
        `Provider "${providerId}" is not configured. Add it under "providers" in ~/.coded/config.json. Known providers: ${available}.`,
        'config',
      );
    }
    const provider = createProvider(providerId, config, this.fetchImpl);
    this.cache.set(providerId, provider);
    return provider;
  }

  resolve(modelRef: string): ResolvedModel {
    const { provider, model } = parseModelRef(modelRef);
    return {
      provider: this.get(provider),
      providerId: provider,
      model,
      contextWindow: contextWindowFor(provider, model, this.config.providers),
    };
  }

  /** Refresh after the user edits keys in the desktop settings. */
  invalidate(): void {
    this.cache.clear();
  }
}
