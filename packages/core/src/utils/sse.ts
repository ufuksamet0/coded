/**
 * Minimal, dependency-free Server-Sent Events reader. Works with the web
 * ReadableStream returned by Node's fetch and by Electron's net stack.
 */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event?: string; data: string }, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line; tolerate CRLF.
      let boundary = findBoundary(buffer);
      while (boundary) {
        const raw = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const parsed = parseEvent(raw);
        if (parsed) yield parsed;
        boundary = findBoundary(buffer);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      const parsed = parseEvent(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
}

function findBoundary(buffer: string): { index: number; length: number } | null {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf === -1 && crlf === -1) return null;
  if (lf !== -1 && (crlf === -1 || lf < crlf)) return { index: lf, length: 2 };
  return { index: crlf, length: 4 };
}

function parseEvent(raw: string): { event?: string; data: string } | null {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (data.length === 0) return null;
  return { event, data: data.join('\n') };
}
