import { parseSSE, type StreamEvent } from '@neotext/shared';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { type MockProvider, startMockProvider } from '../../test-support/mock-provider';
import { chunk, DONE, finish } from '../../test-support/sse-frames';
import { authed, createTestApp, setupOwner, type TestApp } from '../../test-support/test-app';

let t: TestApp;
let mock: MockProvider;
let api: ReturnType<typeof authed>;
let userId: string;
let providerId: string;

const waitFor = async (check: () => boolean, timeoutMs = 5000) => {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};
const activeCount = () => t.c.generations.active(userId).length;

beforeEach(async () => {
  t = await createTestApp();
  mock = await startMockProvider();
  const owner = await setupOwner(t);
  userId = owner.user.id;
  api = authed(t, owner.cookie);
  const res = await api('/api/providers', {
    method: 'POST',
    body: JSON.stringify({ kind: 'openai-compatible', name: 'Mock', baseUrl: mock.url }),
  });
  providerId = ((await res.json()) as { provider: { id: string } }).provider.id;
});
afterEach(async () => {
  for (const g of t.c.generations.active(userId)) t.c.generations.abort(userId, g.id);
  await waitFor(() => activeCount() === 0);
  await t.close();
  await mock.close();
});

/** Reads an SSE response in the background; `disconnect` cancels it like a closed tab. */
function listen(res: Response) {
  const ac = new AbortController();
  const events: StreamEvent[] = [];
  const done = (async () => {
    for await (const msg of parseSSE(res.body as ReadableStream<Uint8Array>, ac.signal)) {
      if (msg.kind === 'data') events.push(JSON.parse(msg.data) as StreamEvent);
    }
  })();
  return { events, done, disconnect: () => ac.abort() };
}

const startTurn = async () => {
  const res = await api('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      conversationId: null,
      parentId: null,
      userMessage: { text: 'Hai' },
      targets: [{ providerId, modelId: 'm1' }],
    }),
  });
  const a = listen(res);
  await waitFor(() => a.events.some((e) => e.type === 'generation.started'));
  const generationId = (a.events[0] as StreamEvent).generationId;
  return { a, generationId };
};
const resume = async (generationId: string) =>
  listen(await api(`/api/generations/${generationId}/stream`));
const types = (evs: StreamEvent[]) => evs.map((e) => e.type);
const deltas = (evs: StreamEvent[]) =>
  evs.flatMap((e) => (e.type === 'text.delta' ? [`${e.seq}:${e.text}`] : []));
const disableBackground = () =>
  api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({ patch: { chat: { continueInBackground: false } } }),
  });

test('a resume sends its snapshot only to the reader that asked for it', async () => {
  mock.enqueue({
    frames: [
      { delayMs: 200 },
      chunk({ content: 'a' }),
      chunk({ content: 'b' }),
      finish('stop'),
      DONE,
    ],
  });
  const { a, generationId } = await startTurn();
  const b = await resume(generationId);
  await Promise.all([a.done, b.done]);

  expect(types(a.events).filter((x) => x === 'generation.started')).toHaveLength(1);
  expect(types(a.events)).not.toContain('generation.snapshot');
  expect(types(b.events)[0]).toBe('generation.snapshot');
  expect(types(b.events)).not.toContain('generation.started');

  for (const evs of [a.events, b.events]) {
    const seqs = evs.map((e) => e.seq);
    expect(seqs).toEqual([...new Set(seqs)].sort((x, y) => x - y));
  }
  expect(
    deltas(a.events)
      .map((d) => d.split(':')[1])
      .join(''),
  ).toBe('ab');
  expect(deltas(b.events)).toEqual(deltas(a.events));
  for (const evs of [a.events, b.events]) {
    expect(types(evs).filter((x) => x === 'generation.finished')).toHaveLength(1);
  }
});

test('without background answers, only the last reader leaving aborts', async () => {
  await disableBackground();
  mock.enqueue({ frames: [chunk({ content: 'a' })], hangAfterFrames: true });
  const { a, generationId } = await startTurn();
  const b = await resume(generationId);
  await waitFor(() => b.events.length > 0);

  a.disconnect();
  await a.done;
  await new Promise((r) => setTimeout(r, 100));
  expect(t.c.generations.get(generationId)?.status()).toBe('streaming');

  b.disconnect();
  await b.done;
  await waitFor(() => activeCount() === 0);
  const started = a.events[0] as Extract<StreamEvent, { type: 'generation.started' }>;
  const d = (await (await api(`/api/conversations/${started.conversationId}`)).json()) as {
    messages: { role: string; status: string }[];
  };
  expect(d.messages.find((m) => m.role === 'assistant')?.status).toBe('aborted');
});
