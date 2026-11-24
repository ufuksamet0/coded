/**
 * Small line-diff engine used for edit previews and permission prompts.
 * Common prefix/suffix are trimmed first, then an LCS table is computed on the
 * remaining window. Very large rewrites fall back to a block replacement so a
 * diff can never freeze the UI.
 */

export type DiffLineType = ' ' | '+' | '-';

export interface DiffLine {
  type: DiffLineType;
  text: string;
  oldLine?: number;
  newLine?: number;
}

const MAX_CELLS = 1_500_000;

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const aMid = a.slice(prefix, a.length - suffix);
  const bMid = b.slice(prefix, b.length - suffix);

  const result: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (let i = 0; i < prefix; i += 1) {
    result.push({ type: ' ', text: a[i]!, oldLine: oldLine++, newLine: newLine++ });
  }

  const middle = diffMiddle(aMid, bMid);
  for (const line of middle) {
    if (line.type === ' ') {
      result.push({ type: ' ', text: line.text, oldLine: oldLine++, newLine: newLine++ });
    } else if (line.type === '-') {
      result.push({ type: '-', text: line.text, oldLine: oldLine++ });
    } else {
      result.push({ type: '+', text: line.text, newLine: newLine++ });
    }
  }

  for (let i = 0; i < suffix; i += 1) {
    result.push({ type: ' ', text: a[a.length - suffix + i]!, oldLine: oldLine++, newLine: newLine++ });
  }

  return result;
}

function diffMiddle(a: string[], b: string[]): DiffLine[] {
  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0) return b.map((text) => ({ type: '+', text }));
  if (b.length === 0) return a.map((text) => ({ type: '-', text }));

  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) {
    return [...a.map((text) => ({ type: '-' as const, text })), ...b.map((text) => ({ type: '+' as const, text }))];
  }

  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Int32Array((n + 1) * width);

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + (j + 1)]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + (j + 1)]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: ' ', text: a[i]! });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j]! >= table[i * width + (j + 1)]!) {
      out.push({ type: '-', text: a[i]! });
      i += 1;
    } else {
      out.push({ type: '+', text: b[j]! });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ type: '-', text: a[i]! });
    i += 1;
  }
  while (j < m) {
    out.push({ type: '+', text: b[j]! });
    j += 1;
  }
  return out;
}

export function diffStat(oldText: string, newText: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diffLines(oldText, newText)) {
    if (line.type === '+') added += 1;
    else if (line.type === '-') removed += 1;
  }
  return { added, removed };
}

export interface UnifiedDiffOptions {
  context?: number;
  oldName?: string;
  newName?: string;
  maxLines?: number;
}

export function unifiedDiff(oldText: string, newText: string, options: UnifiedDiffOptions = {}): string {
  const context = options.context ?? 3;
  const lines = diffLines(oldText, newText);
  const maxLines = options.maxLines ?? 400;

  const hunks: string[] = [];
  let index = 0;
  let rendered = 0;

  while (index < lines.length) {
    // Skip equal lines that are far from any change.
    while (
      index < lines.length &&
      lines[index]!.type === ' ' &&
      !changeNear(lines, index, context)
    ) {
      index += 1;
    }
    if (index >= lines.length) break;

    let start = Math.max(0, index - context);
    let end = index;
    while (end < lines.length) {
      if (lines[end]!.type !== ' ') {
        end += 1;
        // Include trailing context, then look for another change in range.
        let probe = end;
        let hasMore = false;
        for (let k = 0; k < context * 2 && probe < lines.length; k += 1, probe += 1) {
          if (lines[probe]!.type !== ' ') {
            hasMore = true;
            break;
          }
        }
        if (!hasMore) break;
      } else {
        end += 1;
      }
    }
    end = Math.min(lines.length, end + context);

    const slice = lines.slice(start, end);
    const oldStart = slice.find((l) => l.oldLine !== undefined)?.oldLine ?? 0;
    const newStart = slice.find((l) => l.newLine !== undefined)?.newLine ?? 0;
    const oldCount = slice.filter((l) => l.type !== '+').length;
    const newCount = slice.filter((l) => l.type !== '-').length;

    const body: string[] = [];
    for (const line of slice) {
      if (rendered >= maxLines) break;
      body.push(`${line.type}${line.text}`);
      rendered += 1;
    }
    hunks.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    hunks.push(...body);

    index = end;
  }

  if (rendered >= maxLines) hunks.push('… diff truncated …');

  const header = [
    `--- ${options.oldName ?? 'a'}`,
    `+++ ${options.newName ?? 'b'}`,
  ];
  return [...header, ...hunks].join('\n');
}

function changeNear(lines: DiffLine[], index: number, context: number): boolean {
  for (let i = Math.max(0, index - context); i <= Math.min(lines.length - 1, index + context); i += 1) {
    if (lines[i]!.type !== ' ') return true;
  }
  return false;
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  // A trailing newline should not produce a phantom empty line in the diff.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
