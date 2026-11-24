import type { ToolCall, ToolResult } from '@coded/core';

export function summarizeCall(call: ToolCall): string {
  const input = call.input ?? {};
  const path = typeof input.path === 'string' ? input.path : '';
  switch (call.name) {
    case 'read_file':
      return `Read ${path}`;
    case 'write_file':
      return `Write ${path}`;
    case 'edit_file':
      return `Edit ${path}`;
    case 'list_dir':
      return `List ${path || '.'}`;
    case 'glob':
      return `Find ${String(input.pattern ?? '')}`;
    case 'grep':
      return `Search /${String(input.pattern ?? '')}/`;
    case 'run_command': {
      const command = String(input.command ?? '');
      return `$ ${command.length > 70 ? `${command.slice(0, 67)}…` : command}`;
    }
    default:
      return call.name;
  }
}

export function toolStats(result: ToolResult): string | undefined {
  const meta = result.metadata ?? {};
  if (typeof meta.added === 'number' || typeof meta.removed === 'number') {
    return `+${meta.added ?? 0} −${meta.removed ?? 0}`;
  }
  if (typeof meta.exitCode === 'number') return `exit ${meta.exitCode}`;
  if (typeof meta.count === 'number') return `${meta.count} ${meta.count === 1 ? 'match' : 'matches'}`;
  return undefined;
}

export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m${Math.round((ms % 60_000) / 1000)}s`;
}

export function shortenPath(value: string, max = 48): string {
  if (value.length <= max) return value;
  const parts = value.split('/');
  const tail = parts.slice(-2).join('/');
  if (tail.length + 2 <= max) return `…/${tail}`;
  return `…${value.slice(-(max - 1))}`;
}

export function trimOutput(output: string, maxLines: number): string {
  const lines = output.replace(/\r/g, '').split('\n');
  const cleaned = lines.filter((line, index) => !(line === '' && index === lines.length - 1));
  if (cleaned.length <= maxLines) return cleaned.join('\n');
  const remaining = cleaned.length - maxLines;
  return `${cleaned.slice(0, maxLines).join('\n')}\n… ${remaining} more lines`;
}

export function uid(prefix = 'i'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
