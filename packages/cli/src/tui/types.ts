import type { ChatMessage, ToolCall } from '@coded/core';

export interface BannerItem {
  id: string;
  type: 'banner';
  workspace: string;
  model: string;
  version: string;
}

export interface UserItem {
  id: string;
  type: 'user';
  text: string;
}

export interface AssistantItem {
  id: string;
  type: 'assistant';
  text: string;
}

export interface ToolItem {
  id: string;
  type: 'tool';
  callId: string;
  name: string;
  summary: string;
  status: 'done' | 'error';
  output?: string;
  diff?: string;
  stats?: string;
  durationMs?: number;
}

export interface NoticeItem {
  id: string;
  type: 'notice';
  text: string;
  tone?: 'info' | 'success' | 'warning';
}

export interface ErrorItem {
  id: string;
  type: 'error';
  text: string;
  hint?: string;
}

export type TranscriptItem =
  | BannerItem
  | UserItem
  | AssistantItem
  | ToolItem
  | NoticeItem
  | ErrorItem;

export interface RunningTool {
  callId: string;
  name: string;
  summary: string;
  startedAt: number;
}

export interface StreamingMessage {
  id: string;
  text: string;
}

export function messageToItems(message: ChatMessage, index: number): TranscriptItem[] {
  const id = `resume_${index}`;
  if (message.role === 'user') return [{ id, type: 'user', text: message.content }];
  if (message.role === 'assistant') {
    return message.content.trim() ? [{ id, type: 'assistant', text: message.content }] : [];
  }
  const result = message.result;
  return [
    {
      id,
      type: 'tool',
      callId: result.toolCallId,
      name: result.name,
      summary: result.name,
      status: result.isError ? 'error' : 'done',
      output: result.content,
    },
  ];
}

export function toolCallSummary(call: ToolCall): string {
  return call.name;
}
