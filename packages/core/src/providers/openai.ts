import type {
  ChatMessage,
  ChatRequest,
  Provider,
  ProviderEvent,
  ToolCall,
} from '../types.js';
import { CodedError, errorMessage, isAbortError } from '../errors.js';
import { readSse } from '../utils/sse.js';
import type { ProviderConfig } from '../config.js';
import { assertOk, mergeSignals, trimBaseUrl } from './http.js';

interface OpenAiToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: OpenAiToolCallDelta[];
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

/**
 * Works with OpenAI, Ollama, LM Studio, vLLM, OpenRouter, Groq and anything
 * else that implements the /chat/completions streaming protocol.
 */
export class OpenAiProvider implements Provider {
  readonly id: string;
  readonly name: string;
  private readonly baseURL: string;
  private readonly apiKey: string | undefined;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly nativeTools: boolean;

  constructor(id: string, config: ProviderConfig, fetchImpl: typeof fetch = fetch) {
    this.id = id;
    this.name = config.type === 'openai' && id === 'openai' ? 'OpenAI' : id;
    this.baseURL = trimBaseUrl(config.baseURL, 'https://api.openai.com/v1');
    this.apiKey = config.apiKey;
    this.headers = config.headers ?? {};
    this.fetchImpl = fetchImpl;
    this.nativeTools = config.tools !== false;
  }

  async *stream(request: ChatRequest): AsyncGenerator<ProviderEvent, void, unknown> {
    const isReasoning = /^(gpt-5|o1|o3|o4)/i.test(request.model);
    const body: Record<string, unknown> = {
      model: request.model,
      messages: toOpenAiMessages(request.system, request.messages),
      stream: true,
    };

    if (request.temperature !== undefined && !isReasoning) body.temperature = request.temperature;
    if (request.maxTokens !== undefined) {
      body[isReasoning ? 'max_completion_tokens' : 'max_tokens'] = request.maxTokens;
    }
    if (this.nativeTools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
      body.tool_choice = 'auto';
    }
    if (this.baseURL.includes('api.openai.com')) {
      body.stream_options = { include_usage: true };
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...this.headers,
    };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: mergeSignals(request.signal, 10 * 60_000),
      });
    } catch (error) {
      if (isAbortError(error)) throw new CodedError('Request aborted.', 'aborted', error);
      throw new CodedError(`Could not reach ${this.name}: ${errorMessage(error)}`, 'network', error);
    }

    await assertOk(response, this.name);
    if (!response.body) throw new CodedError(`${this.name} returned an empty response body.`, 'provider');

    const pending = new Map<number, { id: string; name: string; arguments: string }>();
    let stopReason = 'stop';
    let emittedDone = false;

    try {
      for await (const event of readSse(response.body)) {
        if (event.data === '[DONE]') break;
        let chunk: OpenAiChunk;
        try {
          chunk = JSON.parse(event.data) as OpenAiChunk;
        } catch {
          continue;
        }
        if (chunk.error?.message) {
          throw new CodedError(`${this.name}: ${chunk.error.message}`, 'provider');
        }
        if (chunk.usage) {
          yield {
            type: 'usage',
            usage: {
              inputTokens: chunk.usage.prompt_tokens,
              outputTokens: chunk.usage.completion_tokens,
            },
          };
        }
        for (const choice of chunk.choices ?? []) {
          const delta = choice.delta;
          if (delta?.content) yield { type: 'text', delta: delta.content };
          for (const call of delta?.tool_calls ?? []) {
            const index = call.index ?? 0;
            const existing = pending.get(index) ?? { id: '', name: '', arguments: '' };
            if (call.id) existing.id = call.id;
            if (call.function?.name) existing.name = call.function.name;
            if (call.function?.arguments) existing.arguments += call.function.arguments;
            pending.set(index, existing);
          }
          if (choice.finish_reason) stopReason = choice.finish_reason;
        }
      }
    } catch (error) {
      if (isAbortError(error)) throw new CodedError('Request aborted.', 'aborted', error);
      if (error instanceof CodedError) throw error;
      throw new CodedError(`Stream error from ${this.name}: ${errorMessage(error)}`, 'network', error);
    }

    const ordered = [...pending.entries()].sort(([a], [b]) => a - b);
    for (const [index, call] of ordered) {
      if (!call.name) continue;
      yield {
        type: 'tool-call',
        call: {
          id: call.id || `call_${Date.now()}_${index}`,
          name: call.name,
          input: parseArguments(call.arguments),
        },
      };
    }

    if (!emittedDone) {
      emittedDone = true;
      yield { type: 'done', stopReason: pending.size > 0 ? 'tool_calls' : stopReason };
    }
  }
}

function parseArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { __parse_error: raw };
  }
}

function toOpenAiMessages(system: string, messages: ChatMessage[]): unknown[] {
  const output: unknown[] = [{ role: 'system', content: system }];
  for (const message of messages) {
    if (message.role === 'user') {
      output.push({ role: 'user', content: message.content });
    } else if (message.role === 'assistant') {
      const toolCalls = message.toolCalls?.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.input) },
      }));
      output.push({
        role: 'assistant',
        content: message.content.length > 0 ? message.content : null,
        ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else {
      output.push({
        role: 'tool',
        tool_call_id: message.result.toolCallId,
        content: message.result.content,
      });
    }
  }
  return output;
}

export type { ToolCall };
