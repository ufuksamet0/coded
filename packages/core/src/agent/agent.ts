import type {
  AgentEvent,
  ChatMessage,
  ConfirmFn,
  ModeDefinition,
  Provider,
  ToolCall,
  ToolResult,
  Usage,
} from '../types.js';
import type { CodedConfig } from '../config.js';
import { CodedError, errorMessage, isAbortError } from '../errors.js';
import { PermissionEngine } from '../permissions.js';
import { createToolRegistry, type ToolRegistry } from '../tools/index.js';
import { estimateTokens, truncateMiddle } from '../utils/text.js';
import { buildSystemPrompt } from './prompt.js';

export interface AgentOptions {
  workspace: string;
  provider: Provider;
  providerId: string;
  model: string;
  config: CodedConfig;
  mode: ModeDefinition;
  confirm?: ConfirmFn;
  /** Skip all permission prompts (explicit user opt-in). */
  yolo?: boolean;
  /** Pre-approve for non-interactive runs (--yes). */
  autoApprove?: boolean;
  maxSteps?: number;
  messages?: ChatMessage[];
  contextWindow?: number;
  extraInstructions?: string;
}

/**
 * The agent loop. Provider-neutral, UI-neutral: it yields events and delegates
 * approvals to a callback. Both the TUI and the desktop app drive this class.
 */
export class Agent {
  readonly messages: ChatMessage[];
  private mode: ModeDefinition;
  private readonly tools: ToolRegistry;
  private readonly permissions: PermissionEngine;
  private readonly maxSteps: number;
  private readonly contextWindow: number;
  private systemPrompt: string | undefined;
  private busy = false;
  private totals: Required<Usage> = { inputTokens: 0, outputTokens: 0 };

  constructor(private readonly options: AgentOptions) {
    this.mode = options.mode;
    this.messages = options.messages ? [...options.messages] : [];
    this.tools = createToolRegistry(options.config);
    this.maxSteps = options.maxSteps ?? options.config.limits.maxSteps;
    this.contextWindow = options.contextWindow ?? options.config.limits.contextTokens;
    this.permissions = new PermissionEngine({
      mode: options.mode,
      config: options.config,
      confirm: options.confirm,
      yolo: options.yolo,
      autoApprove: options.autoApprove,
    });
  }

  get modeId(): string {
    return this.mode.id;
  }

  get modeDefinition(): ModeDefinition {
    return this.mode;
  }

  get usage(): Required<Usage> {
    return { ...this.totals };
  }

  get isBusy(): boolean {
    return this.busy;
  }

  get availableTools(): string[] {
    return this.tools.forMode(this.mode).map((tool) => tool.name);
  }

  updateMode(mode: ModeDefinition): void {
    this.mode = mode;
    this.permissions.updateMode(mode);
    this.systemPrompt = undefined;
  }

  reset(): void {
    this.messages.length = 0;
    this.totals = { inputTokens: 0, outputTokens: 0 };
  }

  async *run(userText: string, signal?: AbortSignal): AsyncGenerator<AgentEvent, void, unknown> {
    if (this.busy) {
      yield { type: 'error', error: new CodedError('The agent is already running.', 'unknown') };
      return;
    }
    const trimmed = userText.trim();
    if (!trimmed) return;

    this.busy = true;
    try {
      this.messages.push({ role: 'user', content: trimmed });
      yield { type: 'turn-start' };

      const system = await this.ensureSystemPrompt();
      const toolDefs = this.tools.forMode(this.mode);

      for (let step = 0; step < this.maxSteps; step += 1) {
        if (signal?.aborted) break;

        yield { type: 'assistant-start' };
        let text = '';
        const calls: ToolCall[] = [];
        const requestUsage: Required<Usage> = { inputTokens: 0, outputTokens: 0 };

        try {
          const stream = this.options.provider.stream({
            model: this.options.model,
            system,
            messages: this.prepareMessages(system),
            tools: toolDefs,
            temperature: this.options.config.temperature,
            maxTokens: this.options.config.maxTokens,
            signal,
          });

          for await (const event of stream) {
            if (event.type === 'text') {
              text += event.delta;
              yield { type: 'text', delta: event.delta };
            } else if (event.type === 'tool-call') {
              calls.push(event.call);
            } else if (event.type === 'usage') {
              if (event.usage.inputTokens !== undefined) {
                requestUsage.inputTokens = Math.max(requestUsage.inputTokens, event.usage.inputTokens);
              }
              if (event.usage.outputTokens !== undefined) {
                requestUsage.outputTokens = Math.max(requestUsage.outputTokens, event.usage.outputTokens);
              }
            }
          }
        } catch (error) {
          if (isAbortError(error) || signal?.aborted) {
            if (text.trim()) {
              const message: ChatMessage = { role: 'assistant', content: text };
              this.messages.push(message);
              yield { type: 'assistant-end', message };
            }
            yield { type: 'turn-end', usage: this.usage };
            return;
          }
          yield { type: 'error', error: normalizeError(error) };
          return;
        }

        this.addUsage(requestUsage);

        const uniqueCalls = dedupeCalls(calls);
        if (!text.trim() && uniqueCalls.length === 0) {
          yield { type: 'error', error: new CodedError('The model returned an empty response.', 'provider') };
          yield { type: 'turn-end', usage: this.usage };
          return;
        }

        const assistant: ChatMessage = {
          role: 'assistant',
          content: text,
          ...(uniqueCalls.length > 0 ? { toolCalls: uniqueCalls } : {}),
        };
        this.messages.push(assistant);
        yield { type: 'assistant-end', message: assistant };

        if (uniqueCalls.length === 0) {
          yield { type: 'turn-end', usage: this.usage };
          return;
        }

        for (const call of uniqueCalls) {
          if (signal?.aborted) {
            yield { type: 'turn-end', usage: this.usage };
            return;
          }
          yield { type: 'tool-start', call };
          const result = await this.executeTool(call, signal);
          this.messages.push({ role: 'tool', result });
          yield { type: 'tool-end', call, result };
        }
      }

      yield {
        type: 'error',
        error: new CodedError(
          `Stopped after ${this.maxSteps} tool steps without finishing. Ask me to continue, or break the task into smaller pieces.`,
          'unknown',
        ),
      };
      yield { type: 'turn-end', usage: this.usage };
    } finally {
      this.busy = false;
    }
  }

  private async executeTool(call: ToolCall, signal: AbortSignal | undefined): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return {
        toolCallId: call.id,
        name: call.name,
        content: `Unknown tool "${call.name}". Available tools: ${this.availableTools.join(', ')}.`,
        isError: true,
      };
    }

    const input =
      call.input && typeof call.input === 'object' && !Array.isArray(call.input)
        ? (call.input as Record<string, unknown>)
        : {};
    if ('__parse_error' in input) {
      return {
        toolCallId: call.id,
        name: call.name,
        content: `Could not parse the tool arguments as JSON. Re-issue the call with valid JSON. Raw: ${String(input.__parse_error).slice(0, 500)}`,
        isError: true,
      };
    }

    const decision = await this.permissions.authorize(tool, input, {
      workspace: this.options.workspace,
      signal,
    });
    if (!decision.allowed) {
      return {
        toolCallId: call.id,
        name: call.name,
        content: `Permission denied: ${decision.reason ?? 'not allowed'}. Do not retry the same action; adapt or ask the user.`,
        isError: true,
      };
    }

    try {
      const result = await tool.run(input, { workspace: this.options.workspace, signal });
      return {
        toolCallId: call.id,
        name: call.name,
        content: truncateMiddle(result.content, this.options.config.limits.maxOutputChars),
        isError: result.isError,
        metadata: result.metadata,
      };
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        return { toolCallId: call.id, name: call.name, content: 'Aborted by the user.', isError: true };
      }
      return {
        toolCallId: call.id,
        name: call.name,
        content: `${call.name} failed: ${errorMessage(error)}`,
        isError: true,
      };
    }
  }

  private async ensureSystemPrompt(): Promise<string> {
    if (!this.systemPrompt) {
      this.systemPrompt = await buildSystemPrompt({
        workspace: this.options.workspace,
        mode: this.mode,
        model: this.options.model,
        provider: this.options.providerId,
        extraInstructions: this.options.extraInstructions,
      });
    }
    return this.systemPrompt;
  }

  private prepareMessages(system: string): ChatMessage[] {
    const budget = Math.max(8_000, Math.floor(this.contextWindow * 0.8));
    const compressed = this.messages.map((message, index) =>
      compressMessage(message, index, this.messages.length),
    );

    let tokens = estimateTokens(system);
    for (const message of compressed) tokens += estimateMessage(message);

    while (tokens > budget && compressed.length > 2) {
      const removed = compressed.shift();
      if (!removed) break;
      tokens -= estimateMessage(removed);
      // Never leave tool results without their assistant tool call.
      if (removed.role === 'assistant' && removed.toolCalls?.length) {
        while (compressed[0]?.role === 'tool') {
          const orphan = compressed.shift();
          if (orphan) tokens -= estimateMessage(orphan);
        }
      }
    }
    while (compressed[0]?.role === 'tool') {
      const orphan = compressed.shift();
      if (orphan) tokens -= estimateMessage(orphan);
    }

    return compressed;
  }

  private addUsage(usage: Required<Usage>): void {
    this.totals.inputTokens += usage.inputTokens;
    this.totals.outputTokens += usage.outputTokens;
  }
}

function dedupeCalls(calls: ToolCall[]): ToolCall[] {
  const seen = new Set<string>();
  const output: ToolCall[] = [];
  for (const call of calls) {
    const key = call.id || `${call.name}:${JSON.stringify(call.input)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(call);
  }
  return output;
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new CodedError(errorMessage(error), 'unknown');
}

function estimateMessage(message: ChatMessage): number {
  if (message.role === 'tool') return estimateTokens(message.result.content) + 20;
  if (message.role === 'assistant') {
    const toolTokens = (message.toolCalls ?? []).reduce(
      (sum, call) => sum + estimateTokens(JSON.stringify(call.input)) + 20,
      0,
    );
    return estimateTokens(message.content) + toolTokens + 10;
  }
  return estimateTokens(message.content) + 10;
}

/**
 * Old write/edit payloads are the biggest context hog in a long session. Once
 * they are several turns old, keep the call/result pairing but drop the file
 * bodies — the model can re-read if it needs them.
 */
function compressMessage(message: ChatMessage, index: number, total: number): ChatMessage {
  const recent = index >= total - 8;
  if (recent) return message;

  if (message.role === 'tool' && message.result.content.length > 4_000) {
    return {
      ...message,
      result: {
        ...message.result,
        content: truncateMiddle(message.result.content, 4_000, 'older tool output truncated'),
      },
    };
  }

  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      ...message,
      toolCalls: message.toolCalls.map((call) => {
        if (call.name !== 'write_file' && call.name !== 'edit_file') return call;
        const input: Record<string, unknown> = { ...call.input };
        for (const key of ['content', 'old_string', 'new_string']) {
          if (typeof input[key] === 'string' && (input[key] as string).length > 500) {
            input[key] = '[omitted from older history — re-read the file if needed]';
          }
        }
        return { ...call, input };
      }),
    };
  }

  return message;
}
