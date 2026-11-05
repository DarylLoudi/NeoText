import { describe, expect, test } from 'vitest';
import { parseSSE, type SSEMessage } from './sse';

const streamOf = (...chunks: (string | Uint8Array)[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) {
        c.enqueue(typeof ch === 'string' ? new TextEncoder().encode(ch) : ch);
      }
      c.close();
    },
  });
const collect = async (s: ReadableStream<Uint8Array>) => {
  const out: SSEMessage[] = [];
  for await (const m of parseSSE(s)) out.push(m);
  return out;
};

describe('parseSSE', () => {
  test('data, comments and DONE across chunk boundaries', async () => {
    expect(
      await collect(streamOf('data: {"a"', ':1}\n\n: OPENROUTER PROCESSING\n\ndata: [DONE]\n\n')),
    ).toEqual([
      { kind: 'data', data: '{"a":1}', event: null, id: null },
      { kind: 'comment', text: ' OPENROUTER PROCESSING' },
      { kind: 'data', data: '[DONE]', event: null, id: null },
    ]);
  });

  test('CRLF and multi-line data', async () => {
    expect(await collect(streamOf('event: x\r\ndata: a\r\ndata: b\r\n\r\n'))).toEqual([
      { kind: 'data', data: 'a\nb', event: 'x', id: null },
    ]);
  });

  test('bare CR line endings', async () => {
    expect(await collect(streamOf('id: 7\rdata: a\r\r'))).toEqual([
      { kind: 'data', data: 'a', event: null, id: '7' },
    ]);
  });

  test('utf-8 split inside a character', async () => {
    const bytes = new TextEncoder().encode('data: Selamat 🌏 pagi\n\n');
    const cut = bytes.indexOf(0xf0) + 2;
    expect((await collect(streamOf(bytes.slice(0, cut), bytes.slice(cut))))[0]).toMatchObject({
      data: 'Selamat 🌏 pagi',
    });
  });

  test('final message without trailing blank line', async () => {
    expect(await collect(streamOf('data: tail'))).toEqual([
      { kind: 'data', data: 'tail', event: null, id: null },
    ]);
  });
});
