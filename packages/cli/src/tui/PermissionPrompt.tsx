import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { PermissionAnswer, PermissionRequest } from '@coded/core';
import { DiffView, diffRowCount } from './DiffView.js';
import { theme } from './theme.js';

const WINDOW = 12;

export function PermissionPrompt({
  request,
  onAnswer,
}: {
  request: PermissionRequest;
  onAnswer: (answer: PermissionAnswer) => void;
}): React.JSX.Element {
  const [offset, setOffset] = useState(0);
  const rows = request.diff ? diffRowCount(request.diff) : 0;
  const maxOffset = Math.max(0, rows - WINDOW);

  useEffect(() => {
    setOffset(0);
  }, [request]);

  useInput((input, key) => {
    if (key.escape) {
      onAnswer('deny');
      return;
    }
    if (key.ctrl && input === 'c') {
      onAnswer('deny');
      return;
    }
    if (key.upArrow) {
      setOffset((current) => Math.max(0, current - 1));
      return;
    }
    if (key.downArrow) {
      setOffset((current) => Math.min(maxOffset, current + 1));
      return;
    }
    if (key.pageUp) {
      setOffset((current) => Math.max(0, current - WINDOW));
      return;
    }
    if (key.pageDown) {
      setOffset((current) => Math.min(maxOffset, current + WINDOW));
      return;
    }
    if (input === 'y' || input === 'Y' || key.return) {
      onAnswer('allow');
      return;
    }
    if (input === 'a' || input === 'A') {
      onAnswer('always');
      return;
    }
    if (input === 'n' || input === 'N') {
      onAnswer('deny');
    }
  });

  return (
    <Box
      marginTop={1}
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.warning}
      paddingX={1}
    >
      <Box>
        <Text color={theme.warning} bold>
          Permission required
        </Text>
        <Text color={theme.faint}> · {request.tool}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.text}>{request.summary}</Text>
      </Box>
      {request.reason ? <Text color={theme.muted}>{request.reason}</Text> : null}
      {request.warning ? (
        <Box marginTop={1}>
          <Text color={theme.error}>⚠ {request.warning}</Text>
        </Box>
      ) : null}
      {request.diff ? (
        <Box marginTop={1} flexDirection="column">
          <DiffView diff={request.diff} maxLines={WINDOW} offset={offset} />
          {rows > WINDOW ? (
            <Text color={theme.faint}>↑/↓ scroll the diff ({rows} lines)</Text>
          ) : null}
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text>
          <Text color={theme.success} bold>
            y
          </Text>
          <Text color={theme.muted}> allow once · </Text>
          <Text color={theme.accent} bold>
            a
          </Text>
          <Text color={theme.muted}> always this session · </Text>
          <Text color={theme.error} bold>
            n
          </Text>
          <Text color={theme.muted}> deny</Text>
        </Text>
      </Box>
    </Box>
  );
}
