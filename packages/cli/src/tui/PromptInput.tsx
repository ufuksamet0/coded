import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { filterCommands } from './commands.js';
import { theme } from './theme.js';

interface Completion {
  kind: 'slash' | 'file';
  name: string;
  label: string;
  detail?: string;
}

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled?: boolean;
  files: string[];
  history: string[];
  clearSignal: number;
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  disabled = false,
  files,
  history,
  clearSignal,
}: PromptInputProps): React.JSX.Element {
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState(0);
  const [historyIndex, setHistoryIndex] = useState(history.length);

  useEffect(() => {
    setCursor((current) => Math.min(current, value.length));
  }, [value]);

  useEffect(() => {
    if (clearSignal > 0) {
      setCursor(0);
      setHistoryIndex(history.length);
    }
    // Only react to the clear signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearSignal]);

  useEffect(() => {
    setHistoryIndex(history.length);
  }, [history.length]);

  const beforeCursor = value.slice(0, cursor);
  const slashQuery =
    value.startsWith('/') && !value.slice(1).includes(' ') ? value.slice(1) : null;
  const mention = /(^|\s)@([^\s@]*)$/.exec(beforeCursor);

  const completions = useMemo<Completion[]>(() => {
    if (slashQuery !== null) {
      return filterCommands(slashQuery).map((command) => ({
        kind: 'slash',
        name: command.name,
        label: `/${command.name}${command.args ? ` ${command.args}` : ''}`,
        detail: command.description,
      }));
    }
    if (mention) {
      const query = (mention[2] ?? '').toLowerCase();
      return files
        .filter((file) => file.toLowerCase().includes(query))
        .slice(0, 8)
        .map((file) => ({ kind: 'file', name: file, label: `@${file}` }));
    }
    return [];
  }, [slashQuery, mention?.[2], files]);

  const queryKey = slashQuery ?? mention?.[2] ?? '';
  useEffect(() => {
    setSelected(0);
  }, [queryKey]);

  const lineInfo = getLineInfo(value, cursor);

  useInput(
    (input, key) => {
      if (disabled) return;

      if (completions.length > 0) {
        if (key.upArrow) {
          setSelected((current) => (current - 1 + completions.length) % completions.length);
          return;
        }
        if (key.downArrow) {
          setSelected((current) => (current + 1) % completions.length);
          return;
        }
        if (key.tab) {
          applyCompletion(completions[selected]!);
          return;
        }
        if (key.return && !key.shift && !key.meta) {
          const exactSlash =
            completions[0]!.kind === 'slash' && `/${completions[0]!.name}` === value;
          if (exactSlash) {
            submit();
          } else {
            applyCompletion(completions[selected]!);
          }
          return;
        }
      }

      if (key.return) {
        if (key.shift || key.meta) {
          insert('\n');
          return;
        }
        if (value.endsWith('\\')) {
          replaceRange(cursor - 1, cursor, '\n');
          return;
        }
        submit();
        return;
      }

      if (input === '\n' && !key.ctrl) {
        insert('\n');
        return;
      }

      if (key.escape) {
        if (value.length > 0) {
          onChange('');
          setCursor(0);
        }
        return;
      }

      if (key.ctrl) {
        switch (input) {
          case 'j':
            insert('\n');
            return;
          case 'a':
            setCursor(lineInfo.start);
            return;
          case 'e':
            setCursor(lineInfo.end);
            return;
          case 'w':
            deleteWord();
            return;
          case 'u':
            replaceRange(lineInfo.start, cursor, '');
            return;
          case 'k':
            replaceRange(cursor, lineInfo.end, '');
            return;
          default:
            return;
        }
      }

      if (key.leftArrow) {
        setCursor((current) => Math.max(0, current - 1));
        return;
      }
      if (key.rightArrow) {
        setCursor((current) => Math.min(value.length, current + 1));
        return;
      }
      if (key.home) {
        setCursor(lineInfo.start);
        return;
      }
      if (key.end) {
        setCursor(lineInfo.end);
        return;
      }
      if (key.upArrow) {
        if (lineInfo.start === 0 && history.length > 0) {
          const next = Math.max(0, historyIndex - 1);
          setHistoryIndex(next);
          const text = history[next] ?? '';
          onChange(text);
          setCursor(text.length);
        } else {
          moveVertical(-1);
        }
        return;
      }
      if (key.downArrow) {
        if (lineInfo.end === value.length) {
          if (historyIndex < history.length - 1) {
            const next = historyIndex + 1;
            setHistoryIndex(next);
            const text = history[next] ?? '';
            onChange(text);
            setCursor(text.length);
          } else {
            setHistoryIndex(history.length);
            onChange('');
            setCursor(0);
          }
        } else {
          moveVertical(1);
        }
        return;
      }
      if (key.backspace || key.delete) {
        if (cursor > 0) {
          replaceRange(cursor - 1, cursor, '');
        }
        return;
      }
      if (key.tab || key.pageUp || key.pageDown || key.escape) return;

      const printable = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      if (printable.length > 0 && [...printable].every((char) => char === '\n' || char >= ' ')) {
        insert(printable);
      }
    },
    { isActive: !disabled },
  );

  function insert(text: string): void {
    const next = value.slice(0, cursor) + text + value.slice(cursor);
    onChange(next);
    setCursor(cursor + text.length);
  }

  function replaceRange(start: number, end: number, text: string): void {
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    setCursor(start + text.length);
  }

  function deleteWord(): void {
    let index = cursor;
    while (index > 0 && /\s/.test(value[index - 1]!)) index -= 1;
    while (index > 0 && !/\s/.test(value[index - 1]!)) index -= 1;
    if (index < cursor) replaceRange(index, cursor, '');
  }

  function moveVertical(direction: -1 | 1): void {
    const current = getLineInfo(value, cursor);
    if (direction === -1 && current.start === 0) return;
    if (direction === 1 && current.end === value.length) return;
    const targetStart =
      direction === -1
        ? value.lastIndexOf('\n', current.start - 2) + 1
        : current.end + 1;
    const targetEnd = value.indexOf('\n', targetStart);
    const end = targetEnd === -1 ? value.length : targetEnd;
    const column = cursor - current.start;
    setCursor(Math.min(targetStart + column, end));
  }

  function applyCompletion(completion: Completion): void {
    if (completion.kind === 'slash') {
      const next = `/${completion.name} `;
      onChange(next);
      setCursor(next.length);
      return;
    }
    const tokenStart = mention ? cursor - (mention[2]?.length ?? 0) - 1 : cursor;
    const next = `${value.slice(0, tokenStart)}@${completion.name} ${value.slice(cursor)}`;
    onChange(next);
    setCursor(tokenStart + completion.name.length + 2);
  }

  function submit(): void {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setCursor(0);
    setHistoryIndex(history.length + 1);
  }

  const display = buildDisplay(value, cursor);
  const borderColor = disabled ? theme.border : theme.accent;

  return (
    <Box flexDirection="column">
      {completions.length > 0 && !disabled ? (
        <Box flexDirection="column" marginBottom={0}>
          {completions.slice(0, 6).map((completion, index) => (
            <Box key={`${completion.kind}-${completion.name}`}>
              <Text color={index === selected ? theme.accent : theme.faint}>
                {index === selected ? '❯ ' : '  '}
              </Text>
              <Text color={index === selected ? theme.accentSoft : theme.muted} bold={index === selected}>
                {completion.label}
              </Text>
              {completion.detail ? <Text color={theme.faint}> {completion.detail}</Text> : null}
            </Box>
          ))}
        </Box>
      ) : null}

      <Box
        borderStyle="round"
        borderColor={borderColor}
        paddingX={1}
        flexDirection="column"
        marginTop={completions.length > 0 ? 1 : 0}
      >
        {display.above > 0 ? <Text color={theme.faint}>↑ {display.above} more lines</Text> : null}
        {display.lines.map((line, index) => {
          const isFirstLine = display.startLine + index === 0;
          return (
            <Box key={index}>
              <Text color={isFirstLine ? theme.accent : theme.faint}>
                {isFirstLine ? '❯ ' : '  '}
              </Text>
              {line.cursor === null ? (
                <Text color={value.length === 0 ? theme.faint : theme.text}>
                  {line.text || (value.length === 0 && isFirstLine ? 'Ask anything, or type / for commands' : ' ')}
                </Text>
              ) : (
                <Text color={theme.text}>
                  {line.text.slice(0, line.cursor)}
                  <Text inverse>{line.text[line.cursor] ?? ' '}</Text>
                  {line.text.slice(line.cursor + 1)}
                </Text>
              )}
            </Box>
          );
        })}
        {display.below > 0 ? <Text color={theme.faint}>↓ {display.below} more lines</Text> : null}
      </Box>
    </Box>
  );
}

interface LineInfo {
  start: number;
  end: number;
  line: number;
  column: number;
}

function getLineInfo(value: string, cursor: number): LineInfo {
  const start = value.lastIndexOf('\n', cursor - 1) + 1;
  const nextBreak = value.indexOf('\n', cursor);
  const end = nextBreak === -1 ? value.length : nextBreak;
  return {
    start,
    end,
    line: value.slice(0, start).split('\n').length - 1,
    column: cursor - start,
  };
}

function buildDisplay(
  value: string,
  cursor: number,
): { lines: Array<{ text: string; cursor: number | null }>; startLine: number; above: number; below: number } {
  const rawLines = value.split('\n');
  const info = getLineInfo(value, cursor);
  const maxVisible = 8;
  let start = Math.max(0, info.line - (maxVisible - 2));
  if (rawLines.length <= maxVisible) start = 0;
  start = Math.min(start, Math.max(0, rawLines.length - maxVisible));
  const end = Math.min(rawLines.length, start + maxVisible);

  const lines = rawLines.slice(start, end).map((text, index) => {
    const absolute = start + index;
    if (absolute !== info.line) return { text, cursor: null };
    return { text, cursor: info.column };
  });

  return {
    lines,
    startLine: start,
    above: start,
    below: Math.max(0, rawLines.length - end),
  };
}
