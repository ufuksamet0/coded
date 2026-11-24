import React from 'react';
import { Box, Text } from 'ink';
import type { ModeDefinition } from '@coded/core';
import { theme } from './theme.js';
import { formatDuration, formatTokens, shortenPath } from './format.js';
import type { RunningTool } from './types.js';

export function StatusBar({
  mode,
  model,
  inputTokens,
  outputTokens,
  busy,
  status,
  running,
  elapsedMs,
  spinner,
}: {
  mode: ModeDefinition;
  model: string;
  inputTokens: number;
  outputTokens: number;
  busy: boolean;
  status: 'thinking' | 'streaming' | 'tool' | 'permission';
  running?: RunningTool;
  elapsedMs: number;
  spinner: string;
}): React.JSX.Element {
  const total = inputTokens + outputTokens;
  const modeColor = mode.id === 'plan' ? theme.warning : theme.success;

  if (busy) {
    const label =
      status === 'permission'
        ? 'Waiting for approval'
        : status === 'tool'
          ? (running?.summary ?? 'Running a tool')
          : status === 'streaming'
            ? 'Writing'
            : 'Thinking';
    return (
      <Box marginTop={1} justifyContent="space-between" flexWrap="wrap">
        <Box>
          <Text color={theme.accent}>{spinner} </Text>
          <Text color={theme.text}>{label}</Text>
          <Text color={theme.faint}> · {formatDuration(elapsedMs)}</Text>
        </Box>
        <Text color={theme.faint}>ctrl+c stop</Text>
      </Box>
    );
  }

  return (
    <Box marginTop={1} justifyContent="space-between" flexWrap="wrap">
      <Box>
        <Text color={modeColor}>●</Text>
        <Text color={theme.text} bold>
          {' '}
          {mode.name}
        </Text>
        <Text color={theme.faint}> · </Text>
        <Text color={theme.muted}>{shortenPath(model, 40)}</Text>
        {total > 0 ? (
          <>
            <Text color={theme.faint}> · </Text>
            <Text color={theme.muted}>{formatTokens(total)} tokens</Text>
          </>
        ) : null}
      </Box>
      <Text color={theme.faint}>enter send · shift+tab mode · /help</Text>
    </Box>
  );
}
