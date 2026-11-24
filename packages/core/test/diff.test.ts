import { describe, expect, it } from 'vitest';
import { diffLines, diffStat, unifiedDiff } from '../src/utils/diff.js';

describe('diffLines', () => {
  it('returns equal lines for identical input', () => {
    const lines = diffLines('a\nb\nc', 'a\nb\nc');
    expect(lines).toEqual([
      { type: ' ', text: 'a', oldLine: 1, newLine: 1 },
      { type: ' ', text: 'b', oldLine: 2, newLine: 2 },
      { type: ' ', text: 'c', oldLine: 3, newLine: 3 },
    ]);
  });

  it('detects a single changed line', () => {
    const lines = diffLines('a\nb\nc', 'a\nB\nc');
    expect(lines.map((l) => `${l.type}${l.text}`)).toEqual([' a', '-b', '+B', ' c']);
    expect(diffStat('a\nb\nc', 'a\nB\nc')).toEqual({ added: 1, removed: 1 });
  });

  it('handles insertions and deletions', () => {
    const lines = diffLines('one\ntwo', 'one\nmiddle\ntwo\nthree');
    expect(lines.filter((l) => l.type === '+').map((l) => l.text)).toEqual(['middle', 'three']);
    expect(lines.filter((l) => l.type === '-')).toHaveLength(0);
  });

  it('keeps line numbers correct after a change', () => {
    const lines = diffLines('a\nb\nc', 'a\nB\nc');
    const plus = lines.find((l) => l.type === '+');
    const minus = lines.find((l) => l.type === '-');
    expect(minus?.oldLine).toBe(2);
    expect(plus?.newLine).toBe(2);
  });

  it('normalizes CRLF', () => {
    expect(diffStat('a\r\nb', 'a\nb')).toEqual({ added: 0, removed: 0 });
  });
});

describe('unifiedDiff', () => {
  it('emits a valid header and hunk', () => {
    const diff = unifiedDiff('a\nb\nc', 'a\nB\nc', { oldName: 'a/x.ts', newName: 'b/x.ts' });
    expect(diff).toContain('--- a/x.ts');
    expect(diff).toContain('+++ b/x.ts');
    expect(diff).toContain('@@ -1,3 +1,3 @@');
    expect(diff).toContain('-b');
    expect(diff).toContain('+B');
  });

  it('shows creation from an empty file', () => {
    const diff = unifiedDiff('', 'hello\nworld', { oldName: '/dev/null', newName: 'b/new.ts' });
    expect(diff).toContain('+hello');
    expect(diff).toContain('+world');
  });

  it('caps very large diffs', () => {
    const before = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n');
    const after = Array.from({ length: 2000 }, (_, i) => `changed ${i}`).join('\n');
    const diff = unifiedDiff(before, after, { maxLines: 50 });
    expect(diff).toContain('diff truncated');
  });
});
