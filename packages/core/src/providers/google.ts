import type { ChatMessage, ChatRequest, Provider, ProviderEvent } from '../types.js';
import { CodedError, errorMessage, isAbortError } from '../errors.js';
import { readSse } from '../utils/sse.js';
import type { ProviderConfig } from '../config.js';
import { assertOk, mergeSignals, requireApiKey, trimBaseUrl } from './http.js';

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

interface GeminiChunk {
  candidates?: Array<{
    content?: { parts?: GeminiPart[]; role?: string };
    finishReason?: string;
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

export class GoogleProvider implements Provider {
  readonly id: string;
  readonly name = 'Google';
  private readonly baseURL: string;
  private readonly apiKey: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(id: string, config: ProviderConfig, fetchImpl: typeof fetch = fetch) {
    this.id = id;
    this.baseURL = trimBaseUrl(config.baseURL, 'https://generativelanguage.googleapis.com/v1beta');
    this.apiKey = requireApiKey(id, config.apiKey, 'GEMINI_API_KEY');
    this.headers = config.headers ?? {};
    this.fetchImpl = fetchImpl;
  }

  async *stream(request: ChatRequest): AsyncGenerator<ProviderEvent, void, unknown> {
    const body: Record<string, unknown> = {
      contents: toGeminiContents(request.messages),
      generationConfig: {
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxTokens !== undefined ? { maxOutputTokens: request.maxTokens } : {}),
      },
    };
    if (request.system.trim()) {
      body.systemInstruction = { parts: [{ text: request.system }] };
    }
    if (request.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: sanitizeSchema(tool.parameters),
          })),
        },
      ];
    }

    const url = `${this.baseURL}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey,
          ...this.headers,
        },
        body: JSON.stringify(body),
        signal: mergeSignals(request.signal, 10 * 60_000),
      });
    } catch (error) {
      if (isAbortError(error)) throw new CodedError('Request aborted.', 'aborted', error);
      throw new CodedError(`Could not reach Google: ${errorMessage(error)}`, 'network', error);
    }

    await assertOk(response, 'Google');
    if (!response.body) throw new CodedError('Google returned an empty response body.', 'provider');

    let stopReason = 'STOP';
    let callCounter = 0;

    try {
      for await (const sse of readSse(response.body)) {
        let chunk: GeminiChunk;
        try {
          chunk = JSON.parse(sse.data) as GeminiChunk;
        } catch {
          continue;
        }
        if (chunk.error?.message) {
          throw new CodedError(`Google: ${chunk.error.message}`, 'provider');
        }
        if (chunk.promptFeedback?.blockReason) {
          throw new CodedError(
            `Google blocked the prompt: ${chunk.promptFeedback.blockReason}`,
            'provider',
          );
        }
        if (chunk.usageMetadata) {
          yield {
            type: 'usage',
            usage: {
              inputTokens: chunk.usageMetadata.promptTokenCount,
              outputTokens: chunk.usageMetadata.candidatesTokenCount,
            },
          };
        }
        for (const candidate of chunk.candidates ?? []) {
          if (candidate.finishReason) stopReason = candidate.finishReason;
          for (const part of candidate.content?.parts ?? []) {
            if ('text' in part && typeof part.text === 'string' && part.text.length > 0) {
              yield { type: 'text', delta: part.text };
            } else if ('functionCall' in part) {
              callCounter += 1;
              yield {
                type: 'tool-call',
                call: {
                  id: `gemini_${Date.now()}_${callCounter}`,
                  name: part.functionCall.name,
                  input: part.functionCall.args ?? {},
                },
              };
            }
          }
        }
      }
    } catch (error) {
      if (isAbortError(error)) throw new CodedError('Request aborted.', 'aborted', error);
      if (error instanceof CodedError) throw error;
      throw new CodedError(`Stream error from Google: ${errorMessage(error)}`, 'network', error);
    }

    yield { type: 'done', stopReason };
  }
}

function toGeminiContents(messages: ChatMessage[]): unknown[] {
  const output: Array<{ role: 'user' | 'model'; parts: GeminiPart[] }> = [];

  for (const message of messages) {
    if (message.role === 'user') {
      if (!message.content.trim()) continue;
      output.push({ role: 'user', parts: [{ text: message.content }] });
    } else if (message.role === 'assistant') {
      const parts: GeminiPart[] = [];
      if (message.content.trim()) parts.push({ text: message.content });
      for (const call of message.toolCalls ?? []) {
        parts.push({ functionCall: { name: call.name, args: call.input } });
      }
      if (parts.length > 0) output.push({ role: 'model', parts });
    } else {
      const part: GeminiPart = {
        functionResponse: {
          name: message.result.name,
          response: message.result.isError
            ? { error: message.result.content }
            : { result: message.result.content },
        },
      };
      const last = output[output.length - 1];
      if (last?.role === 'user') last.parts.push(part);
      else output.push({ role: 'user', parts: [part] });
    }
  }

  return output;
}

const ALLOWED_SCHEMA_KEYS = new Set([
  'type',
  'format',
  'description',
  'nullable',
  'enum',
  'items',
  'properties',
  'required',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'pattern',
]);

/** Gemini rejects several standard JSON Schema keywords. */
function sanitizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!ALLOWED_SCHEMA_KEYS.has(key)) continue;
    if (key === 'properties' && value && typeof value === 'object') {
      const props: Record<string, unknown> = {};
      for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
        if (child && typeof child === 'object') props[name] = sanitizeSchema(child as Record<string, unknown>);
      }
      clean.properties = props;
    } else if (key === 'items' && value && typeof value === 'object') {
      clean.items = sanitizeSchema(value as Record<string, unknown>);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}
