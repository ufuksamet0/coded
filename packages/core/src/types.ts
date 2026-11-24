/**
 * Core data model shared by every provider, the agent loop, the CLI and the
 * desktop app. Everything here is provider-neutral: adapters translate to and
 * from their wire formats.
 */

export type Role = 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
  /** Optional structured data for the UI (diffs, exit codes, durations). */
  metadata?: Record<string, unknown>;
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; result: ToolResult };

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
}

export type ProviderEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool-call'; call: ToolCall }
  | { type: 'usage'; usage: Usage }
  | { type: 'done'; stopReason: string };

export interface ChatRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface Provider {
  readonly id: string;
  readonly name: string;
  stream(request: ChatRequest): AsyncGenerator<ProviderEvent, void, unknown>;
}

/** A JSON Schema object, kept intentionally loose. */
export type JsonSchema = Record<string, unknown>;

export interface ToolContext {
  workspace: string;
  signal?: AbortSignal;
  /** Set when the tool is running inside a sub-agent or non-interactive run. */
  headless?: boolean;
}

export interface ToolResultPayload {
  content: string;
  isError?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ToolPreview {
  summary: string;
  diff?: string;
  reason?: string;
  /** Extra warning shown in the confirmation dialog. */
  warning?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
  /** Hints used by the permission engine and the UI. */
  readOnly: boolean;
  category: PermissionCategory;
  /** Build a human-readable summary before execution (used for approvals). */
  preview?(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolPreview>;
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResultPayload>;
}

export type PermissionPolicy = 'allow' | 'ask' | 'deny';

export type PermissionCategory = 'read' | 'write' | 'shell' | 'network';

export interface PermissionRequest {
  tool: string;
  category: PermissionCategory;
  input: Record<string, unknown>;
  /** Human readable summary, e.g. "Write src/app.ts (+12 −3)". */
  summary: string;
  /** Unified diff for file mutations, when available. */
  diff?: string;
  /** Why the agent wants to do this, when the model provided a rationale. */
  reason?: string;
  /** Extra warning, e.g. a destructive shell command. */
  warning?: string;
}

export type PermissionAnswer = 'allow' | 'always' | 'deny';

export type ConfirmFn = (request: PermissionRequest) => Promise<PermissionAnswer>;

export interface ModeDefinition {
  id: string;
  name: string;
  description: string;
  /** Appended to the base system prompt. */
  prompt: string;
  tools: string[] | '*';
  permissions: Record<PermissionCategory, PermissionPolicy>;
  /** Tools that may run without confirmation even when policy is "ask". */
  autoAllow?: string[];
}

export interface AgentEvent {
  type:
    | 'turn-start'
    | 'assistant-start'
    | 'text'
    | 'assistant-end'
    | 'tool-start'
    | 'tool-end'
    | 'turn-end'
    | 'error';
  delta?: string;
  message?: ChatMessage;
  call?: ToolCall;
  result?: ToolResult;
  usage?: Usage;
  error?: Error;
}

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  workspace: string;
  model: string;
  mode: string;
}

export interface SessionData {
  meta: SessionMeta;
  messages: ChatMessage[];
}
