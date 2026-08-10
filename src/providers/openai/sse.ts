/**
 * Minimal Server-Sent-Events parser for the OpenAI-compatible streaming format
 * (blueprint §11 — provider-specific detail kept inside the provider). Chat
 * completions stream `data: {json}\n\n` frames terminated by `data: [DONE]`.
 *
 * `parseSseStream` consumes a byte stream reader and yields the JSON payload of
 * each `data:` line (as a string), stopping at `[DONE]`. It buffers partial
 * lines across chunks so a frame split mid-JSON is handled correctly.
 */
export async function* parseSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nlIndex = buffer.indexOf('\n');
      while (nlIndex !== -1) {
        const line = buffer.slice(0, nlIndex).trimEnd();
        buffer = buffer.slice(nlIndex + 1);
        const payload = extractData(line);
        if (payload === '[DONE]') return;
        if (payload !== undefined) yield payload;
        nlIndex = buffer.indexOf('\n');
      }
    }
    // Flush any final buffered line (some servers omit a trailing newline).
    const payload = extractData(buffer.trim());
    if (payload !== undefined && payload !== '[DONE]') yield payload;
  } finally {
    // Best-effort release so an aborted stream doesn't leak the connection.
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
    reader.releaseLock();
  }
}

function extractData(line: string): string | undefined {
  if (line === '' || line.startsWith(':')) return undefined; // blank / comment
  if (!line.startsWith('data:')) return undefined;
  return line.slice(5).trimStart();
}
