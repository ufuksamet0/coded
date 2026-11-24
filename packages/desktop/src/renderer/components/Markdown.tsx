import React from 'react';

interface MarkdownProps {
  text: string;
}

export function Markdown({ text }: MarkdownProps) {
  const segments = parseMarkdown(text);
  return (
    <span className="markdown">
      {segments.map((seg, i) => renderSegment(seg, i))}
    </span>
  );
}

interface Segment {
  type: 'text' | 'code' | 'codeblock' | 'bold' | 'italic' | 'link';
  content: string;
  language?: string;
}

function parseMarkdown(text: string): Segment[] {
  const segments: Segment[] = [];
  let remaining = text;
  let current = '';

  while (remaining.length > 0) {
    const codeBlockMatch = remaining.match(/^```(\w*)\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      if (current) {
        segments.push(...parseInline(current));
        current = '';
      }
      segments.push({ type: 'codeblock', content: codeBlockMatch[2], language: codeBlockMatch[1] });
      remaining = remaining.slice(codeBlockMatch[0].length);
      continue;
    }

    const inlineCodeMatch = remaining.match(/^`([^`]+)`/);
    if (inlineCodeMatch) {
      if (current) {
        segments.push(...parseInline(current));
        current = '';
      }
      segments.push({ type: 'code', content: inlineCodeMatch[1] });
      remaining = remaining.slice(inlineCodeMatch[0].length);
      continue;
    }

    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      if (current) {
        segments.push(...parseInline(current));
        current = '';
      }
      segments.push({ type: 'bold', content: boldMatch[1] });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      if (current) {
        segments.push(...parseInline(current));
        current = '';
      }
      segments.push({ type: 'italic', content: italicMatch[1] });
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    current += remaining[0];
    remaining = remaining.slice(1);
  }

  if (current) {
    segments.push(...parseInline(current));
  }

  return segments;
}

function parseInline(text: string): Segment[] {
  const segments: Segment[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      segments.push({ type: 'code', content: codeMatch[1] });
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      segments.push({ type: 'bold', content: boldMatch[1] });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      segments.push({ type: 'italic', content: italicMatch[1] });
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    segments.push({ type: 'text', content: remaining[0] });
    remaining = remaining.slice(1);
  }

  return segments;
}

function renderSegment(seg: Segment, index: number): React.ReactNode {
  switch (seg.type) {
    case 'codeblock':
      return (
        <pre key={index} className="code-block">
          <code className={seg.language ? `language-${seg.language}` : ''}>
            {seg.content}
          </code>
        </pre>
      );
    case 'code':
      return <code key={index} className="inline-code">{seg.content}</code>;
    case 'bold':
      return <strong key={index}>{seg.content}</strong>;
    case 'italic':
      return <em key={index}>{seg.content}</em>;
    case 'link':
      return <a key={index} href={seg.content} target="_blank" rel="noopener noreferrer">{seg.content}</a>;
    default:
      return <span key={index}>{seg.content}</span>;
  }
}