import { Agent, ProviderRegistry, type AgentEvent, type CodedConfig, type ModeDefinition, getMode, parseModelRef, contextWindowFor } from '../index.js';
import { configDir, sessionsDir, projectKey, normalizeWorkspace } from '../utils/paths.js';
import { SessionStore } from '../agent/session.js';
import { createToolRegistry } from '../tools/index.js';
import { PermissionEngine } from '../permissions.js';
import { buildSystemPrompt } from '../agent/prompt.js';
import { estimateTokens, truncateMiddle } from '../utils/text.js';
import { CodedError, errorMessage, isAbortError } from '../errors.js';
import type { ChatMessage, ToolCall, ToolResult, ToolDefinition, Usage, Provider, ConfirmFn } from '../types.js';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export interface CreateAgentOptions {
  workspace: string;
  modelRef: string;
  modeId: string;
  config: CodedConfig;
  yolo?: boolean;
  autoApprove?: boolean;
  resumeMessages?: ChatMessage[];
  onEvent?: (event: any) => void;
}

export interface AgentHandle {
  id: number;
  workspace: string;
  modelRef: string;
  modeId: string;
  config: CodedConfig;
  agent: DesktopAgent;
  destroy: () => Promise<void>;
  run: (input: string) => Promise<void>;
  abort: () => void;
  getMessages: () => ChatMessage[];
}

let nextAgentId = 1;

export function createAgent(options: CreateAgentOptions): AgentHandle {
  const id = nextAgentId++;
  const desktopAgent = new DesktopAgent(id, options);
  return {
    id,
    workspace: options.workspace,
    modelRef: options.modelRef,
    modeId: options.modeId,
    config: options.config,
    agent: desktopAgent,
    destroy: () => desktopAgent.destroy(),
    run: (input) => desktopAgent.run(input),
    abort: () => desktopAgent.abort(),
    getMessages: () => desktopAgent.getMessages(),
  };
}

class DesktopAgent {
  private agent: Agent;
  private abortController: AbortController | null = null;
  private eventChannel: string;
  private destroyed = false;
  private onEvent: ((event: any) => void) | undefined;

  constructor(
    private readonly id: number,
    options: CreateAgentOptions,
  ) {
    const { workspace, modelRef, modeId, config, yolo, autoApprove, resumeMessages, onEvent } = options;

    const registry = new ProviderRegistry(config);
    const resolved = registry.resolve(modelRef);
    const mode = getMode(config, modeId);

    this.agent = new Agent({
      workspace: normalizeWorkspace(workspace),
      provider: resolved.provider,
      providerId: resolved.providerId,
      model: resolved.model,
      config,
      mode,
      confirm: this.handleConfirm.bind(this),
      yolo,
      autoApprove,
      maxSteps: config.limits.maxSteps,
      messages: resumeMessages,
      contextWindow: resolved.contextWindow,
    });

    this.eventChannel = `agent:event:${id}`;
    this.onEvent = onEvent;
  }

  private pendingConfirm: ((answer: 'allow' | 'always' | 'deny') => void) | null = null;

  private handleConfirm = async (request: any): Promise<'allow' | 'always' | 'deny'> => {
    return new Promise((resolve) => {
      this.pendingConfirm = resolve;
      this.emit({
        type: 'permission',
        request: {
          tool: request.tool,
          category: request.category,
          input: request.input,
          summary: request.summary,
          diff: request.diff,
          reason: request.reason,
          warning: request.warning,
        },
      });
    });
  };

  async run(input: string): Promise<void> {
    if (this.destroyed) throw new Error('Agent destroyed');
    this.abortController = new AbortController();

    try {
      for await (const event of this.agent.run(input, this.abortController.signal)) {
        if (this.destroyed) break;
        this.emit(this.mapEvent(event));
      }
    } catch (error) {
      if (!this.destroyed) {
        this.emit({
          type: 'error',
          error: errorMessage(error),
          code: error instanceof CodedError ? error.code : 'unknown',
        });
      }
    } finally {
      this.abortController = null;
    }
  }

  abort(): void {
    this.abortController?.abort();
    if (this.pendingConfirm) {
      this.pendingConfirm('deny');
      this.pendingConfirm = null;
    }
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.abort();
    this.agent.reset();
  }

  getMessages(): ChatMessage[] {
    return this.agent.messages;
  }

  private mapEvent(event: AgentEvent): any {
    switch (event.type) {
      case 'turn-start':
        return { type: 'turn_start' };
      case 'assistant-start':
        return { type: 'assistant_start' };
      case 'text':
        return { type: 'text', delta: event.delta };
      case 'assistant-end':
        return {
          type: 'assistant_end',
          content: event.message?.role === 'assistant' ? event.message.content : '',
        };
      case 'tool-start':
        return {
          type: 'tool_start',
          id: event.call?.id,
          name: event.call?.name,
          input: event.call?.input,
        };
      case 'tool-end':
        return {
          type: 'tool_end',
          id: event.result?.toolCallId,
          name: event.result?.name,
          content: event.result?.content,
          isError: event.result?.isError,
          metadata: event.result?.metadata,
        };
      case 'turn-end':
        return {
          type: 'turn_end',
          usage: event.usage,
        };
      case 'error':
        return {
          type: 'error',
          error: errorMessage(event.error),
          code: event.error instanceof CodedError ? event.error.code : 'unknown',
        };
      default:
        return { type: 'unknown', raw: event };
    }
  }

  private emit(event: any): void {
    if (this.destroyed) return;
    this.onEvent?.(event);
  }

  answerPermission(answer: 'allow' | 'always' | 'deny'): void {
    this.pendingConfirm?.(answer);
    this.pendingConfirm = null;
  }
}