import React from 'react';

interface StatusBarProps {
  mode: { id: string; name: string; description: string } | null;
  model: string;
  tokens: { inputTokens: number; outputTokens: number };
  status: 'idle' | 'thinking' | 'streaming' | 'tool' | 'permission';
  busy: boolean;
}

export function StatusBar({ mode, model, tokens, status, busy }: StatusBarProps) {
  const totalTokens = tokens.inputTokens + tokens.outputTokens;
  const statusLabels: Record<string, string> = {
    idle: 'Ready',
    thinking: 'Thinking...',
    streaming: 'Streaming',
    tool: 'Running tool',
    permission: 'Waiting for approval',
  };

  return (
    <div className="status-bar">
      <div className="status-left">
        {mode && (
          <span className={`mode-badge ${mode.id}`}>
            {mode.name}
          </span>
        )}
        <span className="model-badge">{model}</span>
      </div>
      <div className="status-center">
        <span className={`status-indicator ${status}`}>
          <span className="status-dot"></span>
          {statusLabels[status] || status}
        </span>
      </div>
      <div className="status-right">
        {totalTokens > 0 && (
          <span className="tokens">
            {formatTokens(tokens.inputTokens)} in · {formatTokens(tokens.outputTokens)} out
          </span>
        )}
        <span className="shortcuts">
          <kbd>↵</kbd> Send · <kbd>⇧↵</kbd> New line · <kbd>/</kbd> Commands · <kbd>@</kbd> Files
        </span>
      </div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}