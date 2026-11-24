import fs from 'node:fs/promises';

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(input: string): string {
  return input.replace(ANSI, '');
}

/** Rough token estimate: ~4 characters per token for English + code. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function truncate(text: string, maxChars: number, note = 'truncated'): string {
  if (text.length <= maxChars) return text;
  const omitted = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n\n… ${note}: ${omitted.toLocaleString()} characters omitted`;
}

/** Keep the head and the tail, which is usually where the signal is. */
export function truncateMiddle(text: string, maxChars: number, note = 'truncated'): string {
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  const omitted = text.length - maxChars;
  return `${text.slice(0, half)}\n\n… ${note}: ${omitted.toLocaleString()} characters omitted …\n\n${text.slice(-half)}`;
}

export function withLineNumbers(text: string, startLine = 1): string {
  const lines = text.split('\n');
  const width = String(startLine + lines.length - 1).length;
  return lines.map((line, i) => `${String(startLine + i).padStart(width, ' ')}\t${line}`).join('\n');
}

export function isProbablyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8000);
  if (sample.includes(0)) return true;
  let suspicious = 0;
  for (const byte of sample) {
    if (byte < 7 || (byte > 14 && byte < 32)) suspicious += 1;
  }
  return sample.length > 0 && suspicious / sample.length > 0.3;
}

export async function readTextFile(absolutePath: string): Promise<string> {
  const buffer = await fs.readFile(absolutePath);
  if (isProbablyBinary(buffer)) {
    throw new Error(`File appears to be binary: ${absolutePath}`);
  }
  return buffer.toString('utf8');
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}
