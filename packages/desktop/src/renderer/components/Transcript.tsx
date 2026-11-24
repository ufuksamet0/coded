import React from 'react';
import { Markdown } from './Markdown';

interface TranscriptItem {
  id: string;
  type: 'user' | 'assistant' | 'tool' | 'notice' | 'error' | 'banner';
  text?: string;
  callId?: string;
  name?: string;
  summary?: string;
  status?: 'done' | 'error';
  output?: string;
  diff?: string;
  tone?: 'info' | 'success' | 'warning';
  hint?: string;
}

interface TranscriptProps {
  items: TranscriptItem[];
  streaming: { id: string; text: string } | null;
  runningTools: Array<{ callId: string; name: string; summary: string; startedAt: number }>;
  busy: boolean;
}

export function Transcript({ items, streaming, runningTools, busy }: TranscriptProps) {
  return (
    <div className="transcript" role="log" aria-live="polite">
      {items.map((item) => (
        <TranscriptEntry key={item.id} item={item} />
      ))}
      {streaming && (
        <div className="streaming-message">
          <Markdown text={`${streaming.text}▌`} />
        </div>
      )}
      {runningTools.map((tool) => (
        <div key={tool.callId} className="running-tool">
          <span className="spinner">⠋</span>
          <span className="tool-summary">{tool.summary}</span>
          <span className="tool-time">{formatElapsed(Date.now() - tool.startedAt)}</span>
        </div>
      ))}
      {busy && !streaming && runningTools.length === 0 && (
        <div className="thinking-indicator">
          <span className="spinner">⠋</span>
          <span>Thinking...</span>
        </div>
      )}
    </div>
  );
}

function TranscriptEntry({ item }: { item: TranscriptItem }) {
  switch (item.type) {
    case 'banner':
      return (
        <div className="banner">
          <div className="banner-logo">Coded</div>
          <div className="banner-info">
            <span>{item.workspace}</span>
            <span className="separator">·</span>
            <span>{item.model}</span>
            <span className="separator">·</span>
            <span>v{item.version}</span>
          </div>
        </div>
      );
    case 'user':
      return (
        <div className="message user">
          <div className="message-header">
            <span className="role">You</span>
          </div>
          <div className="message-content">
            <Markdown text={item.text || ''} />
          </div>
        </div>
      );
    case 'assistant':
      return (
        <div className="message assistant">
          <div className="message-header">
            <span className="role">Assistant</span>
          </div>
          <div className="message-content">
            <Markdown text={item.text || ''} />
          </div>
        </div>
      );
    case 'tool':
      return (
        <div className={`tool-result ${item.status}`}>
          <div className="tool-header">
            <span className="tool-name">{item.name}</span>
            <span className="tool-summary">{item.summary}</span>
            <span className={`tool-status ${item.status}`}>
              {item.status === 'error' ? '✗' : '✓'}
            </span>
          </div>
          {item.diff && (
            <div className="tool-diff">
              <DiffView diff={item.diff} />
            </div>
          )}
          {item.output && !item.diff && (
            <div className="tool-output">
              <pre>{item.output}</pre>
            </div>
          )}
        </div>
      );
    case 'notice':
      return (
        <div className={`notice ${item.tone || 'info'}`}>
          {item.text}
        </div>
      );
    case 'error':
      return (
        <div className="error-message">
          <span className="error-icon">⚠</span>
          <span className="error-text">{item.text}</span>
          {item.hint && <span className="error-hint">{item.hint}</span>}
        </div>
      );
    default:
      return null;
  }
}

function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="diff">
      {diff.split('\n').map((line, i) => (
        <span key={i} className={getDiffLineClass(line)}>
          {line}
        </span>
      ))}
    </pre>
  );
}

function getDiffLineClass(line: string): string {
  if (line.startsWith('+')) return 'diff-add';
  if (line.startsWith('-')) return 'diff-remove';
  if (line.startsWith('@')) return 'diff-hunk';
  return 'diff-context';
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}