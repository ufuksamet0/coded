import React from 'react';
import { Box, Text } from 'ink';
import type { ToolResult } from '@coded/core';
import type { TranscriptItem } from './types.js';
import { Markdown } from './Markdown.js';
import { DiffView } from './DiffView.js';
import { theme } from './theme.js';
import { formatDuration, trimOutput } from './format.js';

export function TranscriptEntry({ item }: { item: TranscriptItem }): React.JSX.Element | null {
  switch (item.type) {
    case 'banner':
      return <Banner workspace={item.workspace} model={item.model} version={item.version} />;
    case 'user':
      return (
        <Box marginTop={1}>
          <Text color={theme.accent} bold>
            ❯{' '}
          </Text>
          <Text color={theme.text} bold>
            {item.text}
          </Text>
        </Box>
      );
    case 'assistant':
      return (
        <Box marginTop={1} flexDirection="column">
          <Markdown text={item.text} />
        </Box>
      );
    case 'tool':
      return <ToolEntry item={item} />;
    case 'notice': {
      const color =
        item.tone === 'success' ? theme.success : item.tone === 'warning' ? theme.warning : theme.muted;
      return (
        <Box marginTop={1} paddingLeft={1}>
          <Text color={color}>ℹ {item.text}</Text>
        </Box>
      );
    }
    case 'error':
      return (
        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="round"
          borderColor={theme.error}
          paddingX={1}
        >
          <Text color={theme.error} bold>
            Error
          </Text>
          <Text color={theme.text}>{item.text}</Text>
          {item.hint ? <Text color={theme.muted}>{item.hint}</Text> : null}
        </Box>
      );
    default:
      return null;
  }
}

function ToolEntry({ item }: { item: Extract<TranscriptItem, { type: 'tool' }> }): React.JSX.Element {
  const icon = item.status === 'error' ? '✗' : '✓';
  const iconColor = item.status === 'error' ? theme.error : theme.success;
  const showOutput =
    item.output &&
    item.name === 'run_command' &&
    item.output.trim().length > 0 &&
    !item.diff;
  const showError = item.status === 'error' && item.output;

  return (
    <Box marginTop={1} flexDirection="column">
      <Box>
        <Text color={iconColor}>{icon} </Text>
        <Text color={theme.text}>{item.summary}</Text>
        {item.stats ? <Text color={theme.faint}> · {item.stats}</Text> : null}
        {item.durationMs !== undefined ? (
          <Text color={theme.faint}> · {formatDuration(item.durationMs)}</Text>
        ) : null}
      </Box>
      {item.diff ? (
        <Box marginTop={1} paddingLeft={2}>
          <DiffView diff={item.diff} maxLines={12} />
        </Box>
      ) : null}
      {showError ? (
        <Box marginTop={1} paddingLeft={2}>
          <Text color={theme.error}>{trimOutput(item.output!, 8)}</Text>
        </Box>
      ) : null}
      {showOutput && !showError ? (
        <Box marginTop={1} paddingLeft={2}>
          <Text color={theme.muted}>{trimOutput(stripCommandHeader(item.output!), 8)}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function stripCommandHeader(output: string): string {
  const lines = output.split('\n');
  if (lines[0]?.startsWith('$ ')) lines.shift();
  if (lines[0]?.startsWith('exit code:')) lines.shift();
  while (lines[0] === '') lines.shift();
  return lines.join('\n');
}

export function Banner({
  workspace,
  model,
  version,
}: {
  workspace: string;
  model: string;
  version: string;
}): React.JSX.Element {
  const columns = process.stdout.columns ?? 100;
  const logo = [
    ' ██████╗ ██████╗ ██████╗ ███████╗██████╗ ',
    '██╔════╝██╔═══██╗██╔══██╗██╔════╝██╔══██╗',
    '██║     ██║   ██║██║  ██║█████╗  ██║  ██║',
    '██║     ██║   ██║██║  ██║██╔══╝  ██║  ██║',
    '╚██████╗╚██████╔╝██████╔╝███████╗██████╔╝',
    ' ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═════╝ ',
  ];

  if (columns < 62) {
    return (
      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        <Text>
          <Text color={theme.accent} bold>
            coded
          </Text>
          <Text color={theme.faint}> v{version}</Text>
        </Text>
        <Text color={theme.muted}>
          {workspace} · {model}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      {logo.map((line, index) => (
        <Text key={index} color={index < 3 ? theme.accent : theme.accentSoft}>
          {line}
        </Text>
      ))}
      <Box marginTop={1}>
        <Text color={theme.muted}>
          <Text color={theme.accentSoft}>v{version}</Text>
          <Text color={theme.faint}> · </Text>
          {workspace}
          <Text color={theme.faint}> · </Text>
          {model}
        </Text>
      </Box>
      <Text color={theme.faint}>Describe a change, ask about the code, or type / for commands.</Text>
    </Box>
  );
}

export function toolResultOutput(result: ToolResult): string | undefined {
  return result.content;
}
