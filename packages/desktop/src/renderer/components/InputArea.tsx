import React, { useRef, useEffect, useState, useCallback } from 'react';

interface InputAreaProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function InputArea({ value, onChange, onSubmit, disabled, placeholder }: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [height, setHeight] = useState(44);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [completions, setCompletions] = useState<Array<{ label: string; detail?: string; insert: string }>>([]);
  const [showCompletions, setShowCompletions] = useState(false);
  const [selectedCompletion, setSelectedCompletion] = useState(0);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const newHeight = Math.min(Math.max(textareaRef.current.scrollHeight, 44), 200);
      setHeight(newHeight);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    updateCompletions(newValue, e.target.selectionStart);
  };

  const updateCompletions = (text: string, cursor: number) => {
    const beforeCursor = text.slice(0, cursor);
    const slashMatch = beforeCursor.match(/\/(\w*)$/);
    const atMatch = beforeCursor.match(/@(\w*)$/);

    if (slashMatch) {
      const query = slashMatch[1].toLowerCase();
      const commands = [
        { label: '/help', detail: 'Show help', insert: '/help ' },
        { label: '/mode', detail: 'Switch mode', insert: '/mode ' },
        { label: '/model', detail: 'Switch model', insert: '/model ' },
        { label: '/keys', detail: 'Manage API keys', insert: '/keys ' },
        { label: '/clear', detail: 'Clear conversation', insert: '/clear ' },
        { label: '/compact', detail: 'Compact context', insert: '/compact ' },
        { label: '/init', detail: 'Write AGENTS.md', insert: '/init ' },
        { label: '/sessions', detail: 'List sessions', insert: '/sessions ' },
        { label: '/resume', detail: 'Resume session', insert: '/resume ' },
        { label: '/usage', detail: 'Show token usage', insert: '/usage ' },
        { label: '/exit', detail: 'Exit', insert: '/exit ' },
      ];
      const filtered = commands.filter((c) => c.label.slice(1).startsWith(query));
      setCompletions(filtered);
      setShowCompletions(filtered.length > 0);
      setSelectedCompletion(0);
    } else if (atMatch) {
      const query = atMatch[1].toLowerCase();
      // Would show file completions here
      setCompletions([]);
      setShowCompletions(false);
    } else {
      setCompletions([]);
      setShowCompletions(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showCompletions && completions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedCompletion((i) => (i + 1) % completions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedCompletion((i) => (i - 1 + completions.length) % completions.length);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        applyCompletion(completions[selectedCompletion]);
        return;
      }
      if (e.key === 'Escape') {
        setShowCompletions(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      submit();
      return;
    }

    if (e.key === 'ArrowUp' && !showCompletions) {
      e.preventDefault();
      navigateHistory(-1);
      return;
    }

    if (e.key === 'ArrowDown' && !showCompletions) {
      e.preventDefault();
      navigateHistory(1);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      const newValue = value + '\n';
      onChange(newValue);
      return;
    }
  };

  const applyCompletion = (completion: { insert: string }) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursor = textarea.selectionStart;
    const beforeCursor = value.slice(0, cursor);
    const afterCursor = value.slice(cursor);
    let newValue: string;

    if (beforeCursor.endsWith('/')) {
      newValue = beforeCursor.slice(0, -1) + completion.insert + afterCursor;
    } else {
      const lastSlash = beforeCursor.lastIndexOf('/');
      if (lastSlash >= 0 && beforeCursor.slice(lastSlash + 1).trim() === '') {
        newValue = beforeCursor.slice(0, lastSlash + 1) + completion.insert + afterCursor;
      } else {
        newValue = value + completion.insert;
      }
    }
    onChange(newValue);
    setShowCompletions(false);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newCursor = cursor + completion.insert.length - (beforeCursor.endsWith('/') ? 1 : 0);
        textareaRef.current.setSelectionRange(newCursor, newCursor);
      }
    }, 0);
  };

  const navigateHistory = (direction: number) => {
    if (history.length === 0) return;
    let newIndex = historyIndex + direction;
    if (newIndex < -1) newIndex = -1;
    if (newIndex >= history.length) newIndex = history.length - 1;
    setHistoryIndex(newIndex);
    if (newIndex === -1) {
      onChange('');
    } else {
      onChange(history[newIndex]);
    }
  };

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setHistory((prev) => [...prev, trimmed].slice(-100));
    setHistoryIndex(-1);
    onChange('');
    setShowCompletions(false);
  };

  return (
    <div className="input-area">
      <div className="input-wrapper">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          style={{ height: `${height}px` }}
          className="input-textarea"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
      </div>
      {showCompletions && completions.length > 0 && (
        <div className="completions">
          {completions.map((comp, i) => (
            <div
              key={comp.label}
              className={`completion-item ${i === selectedCompletion ? 'selected' : ''}`}
              onClick={() => applyCompletion(comp)}
            >
              <span className="completion-label">{comp.label}</span>
              {comp.detail && <span className="completion-detail">{comp.detail}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}