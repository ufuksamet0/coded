import { CodedError } from '../errors.js';

export function trimBaseUrl(baseURL: string | undefined, fallback: string): string {
  const value = (baseURL ?? fallback).replace(/\/+$/, '');
  // Ollama and LM Studio are commonly configured without the /v1 suffix.
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(value)) {
    return `${value}/v1`;
  }
  return value;
}

export async function assertOk(response: Response, provider: string): Promise<void> {
  if (response.ok) return;
  let body = '';
  try {
    body = await response.text();
  } catch {
    // ignore
  }
  const detail = extractErrorMessage(body) ?? body.slice(0, 500);
  const status = response.status;
  if (status === 401 || status === 403) {
    throw new CodedError(
      `${provider} rejected the API key (${status}). ${detail}`.trim(),
      'auth',
    );
  }
  if (status === 429) {
    throw new CodedError(`${provider} rate limit reached (429). ${detail}`.trim(), 'rate_limit');
  }
  if (status >= 500) {
    throw new CodedError(`${provider} server error (${status}). ${detail}`.trim(), 'provider');
  }
  throw new CodedError(`${provider} request failed (${status}). ${detail}`.trim(), 'provider');
}

function extractErrorMessage(body: string): string | undefined {
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    const error = json.error as Record<string, unknown> | string | undefined;
    if (typeof error === 'string') return error;
    if (error && typeof error.message === 'string') return error.message;
    if (typeof json.message === 'string') return json.message;
  } catch {
    // Not JSON.
  }
  return undefined;
}

export function mergeSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function requireApiKey(id: string, apiKey: string | undefined, envHint: string): string {
  if (!apiKey) {
    throw new CodedError(
      `No API key configured for "${id}". Set ${envHint} or add providers.${id}.apiKey to ~/.coded/config.json.`,
      'auth',
    );
  }
  return apiKey;
}
