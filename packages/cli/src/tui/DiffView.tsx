import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme.js';

interface DiffRow {
  type: ' ' | '+' | '-' | '@';
  text: string;
  oldLine?: number;
  newLine?: number;
}

export function DiffView({
  diff,
  maxLines = 16,
  offset = 0,
}: {
  diff: string;
  maxLines?: number;
  offset?: number;
}): React.JSX.Element {
  const rows = useMemo(() => parseDiff(diff), [diff]);
  const visible = rows.slice(offset, offset + maxLines);
  const hidden = Math.max(0, rows.length - offset - visible.length);
  const width = Math.max(3, String(Math.max(...rows.map((row) => row.newLine ?? 0), 1)).length);

  return (
    <Box flexDirection="column">
      {offset > 0 ? <Text color={theme.faint}>↑ {offset} more lines</Text> : null}
      {visible.map((row, index) => {
        if (row.type === '@') {
          return (
            <Text key={index} color={theme.faint} wrap="truncate">
              {row.text}
            </Text>
          );
        }
        const color = row.type === '+' ? theme.green : row.type === '-' ? theme.red : theme.muted;
        const oldLabel = row.oldLine ? String(row.oldLine).padStart(width) : ' '.repeat(width);
        const newLabel = row.newLine ? String(row.newLine).padStart(width) : ' '.repeat(width);
        return (
          <Box key={index}>
            <Text color={theme.faint}>
              {oldLabel} {newLabel}{' '}
            </Text>
            <Text color={color} wrap="truncate">
              {row.type === ' ' ? ' ' : row.type}
              {row.text}
            </Text>
          </Box>
        );
      })}
      {hidden > 0 ? <Text color={theme.faint}>↓ {hidden} more lines</Text> : null}
    </Box>
  );
}

export function diffRowCount(diff: string): number {
  return parseDiff(diff).length;
}

function parseDiff(diff: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of diff.replace(/\r/g, '').split('\n')) {
    if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('\\ No newline')) continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      rows.push({ type: '@', text: line });
      continue;
    }
    if (line.startsWith('+')) {
      rows.push({ type: '+', text: line.slice(1), newLine });
      newLine += 1;
    } else if (line.startsWith('-')) {
      rows.push({ type: '-', text: line.slice(1), oldLine });
      oldLine += 1;
    } else if (line.startsWith(' ')) {
      rows.push({ type: ' ', text: line.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    } else if (line.length > 0) {
      rows.push({ type: ' ', text: line });
    }
  }

  return rows;
}
