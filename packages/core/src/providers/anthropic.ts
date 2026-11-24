import type { ChatMessage, ChatRequest, Provider, ProviderEvent } from '../types.js';
import { CodedError, errorMessage, isAbortError } from '../errors.js';
import { readSse } from '../utils/sse.js';
import type { ProviderConfig } from '../config.js';
import { assertOk, mergeSignals, requireApiKey, trimBaseUrl } from './http.js';

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

interface AnthropicEvent {
  type: string;
  index?: number;
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  content_block?: { type: string; id?: string; name?: string; text?: string };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: { output_tokens?: number };
  error?: { message?: string };
}

export class AnthropicProvider implements Provider {
  readonly id: string;
  readonly name = 'Anthropic';
  private readonly baseURL: string;
  private readonly apiKey: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(id: string, config: ProviderConfig, fetchImpl: typeof fetch = fetch) {
    this.id = id;
    this.baseURL = trimBaseUrl(config.baseURL, 'https://api.anthropic.com');
    this.apiKey = requireApiKey(id, config.apiKey, 'ANTHROPIC_API_KEY');
    this.headers = config.headers ?? {};
    this.fetchImpl = fetchImpl;
  }

  async *stream(request: ChatRequest): AsyncGenerator<ProviderEvent, void, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens ?? 8192,
      system: request.system,
      messages: toAnthropicMessages(request.messages),
      stream: true,
    };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseURL}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          ...this.headers,
        },
        body: JSON.stringify(body),
        signal: mergeSignals(request.signal, 10 * 60_000),
      });
    } catch (error) {
      if (isAbortError(error)) throw new CodedError('Request aborted.', 'aborted', error);
      throw new CodedError(`Could not reach Anthropic: ${errorMessage(error)}`, 'network', error);
    }

    await assertOk(response, 'Anthropic');
    if (!response.body) throw new CodedError('Anthropic returned an empty response body.', 'provider');

    const blocks = new Map<number, { id: string; name: string; json: string; text: string }>();
    let stopReason = 'end_turn';

    try {
      for await (const sse of readSse(response.body)) {
        let event: AnthropicEvent;
        try {
          event = JSON.parse(sse.data) as AnthropicEvent;
        } catch {
          continue;
        }

        switch (event.type) {
          case 'message_start': {
            const usage = event.message?.usage;
            if (usage?.input_tokens) {
              yield { type: 'usage', usage: { inputTokens: usage.input_tokens } };
            }
            break;
          }
          case 'content_block_start': {
            if (event.index === undefined || !event.content_block) break;
            if (event.content_block.type === 'tool_use') {
              blocks.set(event.index, {
                id: event.content_block.id ?? `toolu_${event.index}`,
                name: event.content_block.name ?? '',
                json: '',
                text: '',
              });
            }
            break;
          }
          case 'content_block_delta': {
            const delta = event.delta;
            if (!delta) break;
            if (delta.type === 'text_delta' && delta.text) {
              yield { type: 'text', delta: delta.text };
            } else if (delta.type === 'input_json_delta' && event.index !== undefined) {
              const block = blocks.get(event.index);
              if (block) block.json += delta.partial_json ?? '';
            }
            break;
          }
          case 'content_block_stop': {
            if (event.index === undefined) break;
            const block = blocks.get(event.index);
            if (block && block.name) {
              yield {
                type: 'tool-call',
                call: { id: block.id, name: block.name, input: parseJsonObject(block.json) },
              };
              blocks.delete(event.index);
            }
            break;
          }
          case 'message_delta': {
            if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
            if (event.usage?.output_tokens) {
              yield { type: 'usage', usage: { outputTokens: event.usage.output_tokens } };
            }
            break;
          }
          case 'error': {
            throw new CodedError(`Anthropic: ${event.error?.message ?? 'stream error'}`, 'provider');
          }
          default:
            break;
        }
      }
    } catch (error) {
      if (isAbortError(error)) throw new CodedError('Request aborted.', 'aborted', error);
      if (error instanceof CodedError) throw error;
      throw new CodedError(`Stream error from Anthropic: ${errorMessage(error)}`, 'network', error);
    }

    yield { type: 'done', stopReason };
  }
}

function parseJsonObject(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return { __parse_error: raw };
  }
}

function toAnthropicMessages(messages: ChatMessage[]): unknown[] {
  const output: Array<{ role: 'user' | 'assistant'; content: AnthropicBlock[] }> = [];
  const knownToolIds = new Set<string>();

  for (const message of messages) {
    if (message.role === 'user') {
      if (!message.content.trim()) continue;
      output.push({ role: 'user', content: [{ type: 'text', text: message.content }] });
    } else if (message.role === 'assistant') {
      const blocks: AnthropicBlock[] = [];
      if (message.content.trim()) blocks.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
        knownToolIds.add(call.id);
      }
      if (blocks.length > 0) output.push({ role: 'assistant', content: blocks });
    } else {
      if (!knownToolIds.has(message.result.toolCallId)) continue;
      const block: AnthropicBlock = {
        type: 'tool_result',
        tool_use_id: message.result.toolCallId,
        content: message.result.content,
        ...(message.result.isError ? { is_error: true } : {}),
      };
      const last = output[output.length - 1];
      if (last?.role === 'user') last.content.push(block);
      else output.push({ role: 'user', content: [block] });
    }
  }

  // The API requires the conversation to start with a user turn.
  while (output.length > 0 && output[0]!.role !== 'user') output.shift();
  return output;
}
