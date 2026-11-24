import React, { useMemo, type ReactNode } from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme.js';

type Block =
  | { kind: 'code'; lang: string; lines: string[] }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'bullet'; marker: string; depth: number; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'rule' }
  | { kind: 'para'; lines: string[] }
  | { kind: 'blank' };

function isSpecial(line: string): boolean {
  return (
    line.trimStart().startsWith('```') ||
    /^#{1,6}\s/.test(line) ||
    /^\s*([-*+]|\d+[.)])\s+/.test(line) ||
    /^>\s?/.test(line) ||
    /^\s*([-*_])\1{2,}\s*$/.test(line)
  );
}

export function Markdown({ text }: { text: string }): React.JSX.Element {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <Box flexDirection="column">
      {blocks.map((block, index) => renderBlock(block, index))}
    </Box>
  );
}

function parseBlocks(input: string): Block[] {
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.trimStart().startsWith('```')) {
        code.push(lines[i]!);
        i += 1;
      }
      i += 1;
      blocks.push({ kind: 'code', lang, lines: code });
      continue;
    }

    if (line.trim() === '') {
      blocks.push({ kind: 'blank' });
      i += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]! });
      i += 1;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push({ kind: 'rule' });
      i += 1;
      continue;
    }

    const bullet = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      blocks.push({
        kind: 'bullet',
        marker: bullet[2]!,
        depth: Math.floor(bullet[1]!.length / 2),
        text: bullet[3]!,
      });
      i += 1;
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      const quoteLines = [quote[1]!];
      i += 1;
      while (i < lines.length && /^>\s?/.test(lines[i]!)) {
        quoteLines.push(lines[i]!.replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ kind: 'quote', text: quoteLines.join('\n') });
      continue;
    }

    const paragraph: string[] = [line];
    i += 1;
    while (i < lines.length && lines[i]!.trim() !== '' && !isSpecial(lines[i]!)) {
      paragraph.push(lines[i]!);
      i += 1;
    }
    blocks.push({ kind: 'para', lines: paragraph });
  }

  return blocks;
}

function renderBlock(block: Block, index: number): ReactNode {
  switch (block.kind) {
    case 'blank':
      return <Box key={index} height={1} />;
    case 'rule':
      return (
        <Text key={index} color={theme.faint}>
          {'─'.repeat(36)}
        </Text>
      );
    case 'heading': {
      const color = block.level === 1 ? theme.accentSoft : block.level === 2 ? theme.text : theme.muted;
      return (
        <Box key={index} marginTop={block.level <= 2 ? 1 : 0}>
          <Text bold color={color}>
            {block.text}
          </Text>
        </Box>
      );
    }
    case 'bullet':
      return (
        <Box key={index} paddingLeft={block.depth * 2}>
          <Text color={theme.accent}>{block.marker === '-' || block.marker === '*' || block.marker === '+' ? '•' : block.marker} </Text>
          <Text color={theme.text}>{renderInline(block.text, `${index}`)}</Text>
        </Box>
      );
    case 'quote':
      return (
        <Box key={index} borderStyle="single" borderTop={false} borderBottom={false} borderRight={false} borderLeftColor={theme.faint} paddingLeft={1}>
          <Text color={theme.muted} italic>
            {renderInline(block.text, `${index}`)}
          </Text>
        </Box>
      );
    case 'code':
      return (
        <Box
          key={index}
          flexDirection="column"
          borderStyle="single"
          borderTop={false}
          borderBottom={false}
          borderRight={false}
          borderLeftColor={theme.border}
          paddingLeft={1}
          marginY={1}
        >
          {block.lang ? (
            <Text color={theme.faint} dimColor>
              {block.lang}
            </Text>
          ) : null}
          {block.lines.map((line, lineIndex) => (
            <Text key={lineIndex} color={theme.code} wrap="truncate">
              {highlightLine(line)}
            </Text>
          ))}
        </Box>
      );
    case 'para':
      return (
        <Text key={index} color={theme.text}>
          {renderInline(block.lines.join('\n'), `${index}`)}
        </Text>
      );
    default:
      return null;
  }
}

export function renderInline(text: string, keyPrefix = 'in'): ReactNode[] {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^)\n]+\))/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0]!;
    const key = `${keyPrefix}-${index}`;
    index += 1;

    if (token.startsWith('`')) {
      nodes.push(
        <Text key={key} color={theme.cyan}>
          {token.slice(1, -1)}
        </Text>,
      );
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(
        <Text key={key} bold>
          {token.slice(2, -2)}
        </Text>,
      );
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      nodes.push(
        <Text key={key}>
          <Text color={theme.blue} underline>
            {link?.[1] ?? token}
          </Text>
          <Text color={theme.faint}> ({link?.[2] ?? ''})</Text>
        </Text>,
      );
    } else {
      nodes.push(
        <Text key={key} italic>
          {token.slice(1, -1)}
        </Text>,
      );
    }
    last = match.index + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function highlightLine(line: string): ReactNode {
  const trimmed = line.trimStart();
  if (
    trimmed.startsWith('//') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('--') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('<!--')
  ) {
    return <Text color={theme.muted} italic>{line}</Text>;
  }

  const nodes: ReactNode[] = [];
  const pattern = /(["'`])(?:\\.|(?!\1)[^\\])*\1/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(line)) !== null) {
    if (match.index > last) nodes.push(line.slice(last, match.index));
    nodes.push(
      <Text key={`s${index}`} color={theme.yellow}>
        {match[0]}
      </Text>,
    );
    index += 1;
    last = match.index + match[0].length;
  }
  if (last < line.length) nodes.push(line.slice(last));
  return nodes.length > 0 ? nodes : line;
}
