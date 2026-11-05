export type SSEMessage =
  | { kind: 'data'; data: string; event: string | null; id: string | null }
  | { kind: 'comment'; text: string };

/** Parses a Server-Sent Events byte stream into messages. */
export async function* parseSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SSEMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  let buffer = '';
  let dataLines: string[] = [];
  let hasData = false;
  let event: string | null = null;
  let id: string | null = null;

  const dispatch = (): SSEMessage | null => {
    const msg: SSEMessage | null = hasData
      ? { kind: 'data', data: dataLines.join('\n'), event, id }
      : null;
    dataLines = [];
    hasData = false;
    event = null;
    id = null;
    return msg;
  };

  const handleLine = (line: string): SSEMessage | null => {
    if (line === '') return dispatch();
    if (line.startsWith(':')) return { kind: 'comment', text: line.slice(1) };
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') {
      dataLines.push(value);
      hasData = true;
    } else if (field === 'event') event = value;
    else if (field === 'id') id = value;
    return null;
  };

  try {
    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // A trailing CR may be half of a CRLF split across chunks; keep it buffered.
      let start = 0;
      for (let i = 0; i < buffer.length; i++) {
        const ch = buffer[i];
        if (ch !== '\n' && ch !== '\r') continue;
        if (ch === '\r' && i === buffer.length - 1) break;
        const msg = handleLine(buffer.slice(start, i));
        if (ch === '\r' && buffer[i + 1] === '\n') i++;
        start = i + 1;
        if (msg) yield msg;
      }
      buffer = buffer.slice(start);
    }
    buffer += decoder.decode();
    for (const raw of buffer.split(/\r\n|\n|\r/)) {
      if (raw === '' && buffer !== '') continue;
      const msg = handleLine(raw);
      if (msg) yield msg;
    }
    const tail = dispatch();
    if (tail) yield tail;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}
