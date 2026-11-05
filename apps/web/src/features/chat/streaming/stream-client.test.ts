import type { ChatRequestBody, StreamEvent } from '@neotext/shared';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '../../../lib/api/client';
import { createQueryClient } from '../../../lib/query';
import { getGenerationsState, liveMessageFor, resetGenerations } from '../../../state/generations';
import { eventsFor, msg, sseStream, textOf } from '../../../test/chat-fixtures';
import { server } from '../../../test/msw';
import { RESUME_BACKOFF_MS, RESUME_MAX_MS, setStreamQueryClient, startTurn } from './stream-client';

const body: ChatRequestBody = {
  conversationId: 'cnv_1',
  parentId: null,
  userMessage: { text: 'Halo', attachmentIds: [] },
  targets: [{ providerId: 'prv_1', modelId: 'acme/neo-writer-2' }],
  options: {
    webSearch: false,
    reasoningEffort: null,
    temperature: null,
    maxOutputTokens: null,
    presetId: null,
    agentId: null,
    folderId: null,
    timeZone: 'Asia/Jakarta',
  },
};

const assistant = msg({ id: 'msg_a', status: 'streaming' });
const sse = (events: StreamEvent[], opts?: { fail?: boolean }) =>
  new HttpResponse(sseStream(events, opts), { headers: { 'Content-Type': 'text/event-stream' } });

beforeEach(() => {
  resetGenerations();
  setStreamQueryClient(createQueryClient());
});

test('the backoff schedule is the agreed one', () => {
  expect(RESUME_BACKOFF_MS).toEqual([250, 500, 1000, 2000, 5000]);
  expect(RESUME_MAX_MS).toBe(60_000);
});

test('a finished stream feeds the store and every event reaches onEvent', async () => {
  const e = eventsFor('gen_1');
  const final = msg({ id: 'msg_a', parts: [{ type: 'text', text: 'Halo' }], finishReason: 'stop' });
  const events = [
    e.started(assistant),
    e.text('Halo'),
    e.finished(final),
    e.titled('cnv_1', 'Sapa'),
  ];
  let key: string | null = null;
  server.use(
    http.post('/api/chat', ({ request }) => {
      key = request.headers.get('Idempotency-Key');
      return sse(events);
    }),
  );
  const onEvent = vi.fn();
  await startTurn(body, { idempotencyKey: 'key-1', onEvent });
  expect(key).toBe('key-1');
  // conversation.updated arrives after generation.finished and is still delivered.
  expect(onEvent.mock.calls.map(([x]) => x.type)).toEqual([
    'generation.started',
    'text.delta',
    'generation.finished',
    'conversation.updated',
  ]);
  expect(liveMessageFor('msg_a')?.status).toBe('complete');
});

test('a dropped stream resumes from a snapshot', async () => {
  const e = eventsFor('gen_1');
  const reconnectingAtResume: (boolean | undefined)[] = [];
  server.use(
    http.post('/api/chat', () => sse([e.started(assistant), e.text('Halo')], { fail: true })),
    http.get('/api/generations/gen_1/stream', () => {
      reconnectingAtResume.push(getGenerationsState().byId.gen_1?.reconnecting);
      const snap = msg({
        id: 'msg_a',
        status: 'streaming',
        parts: [{ type: 'text', text: 'Halo dunia' }],
      });
      const done = msg({
        id: 'msg_a',
        status: 'complete',
        parts: [{ type: 'text', text: 'Halo dunia' }],
      });
      const r = eventsFor('gen_1', 7);
      // The late delta repeats text the snapshot already holds and must be dropped.
      return sse([r.snapshot(snap), r.text(' dunia', 7), r.finished(done)]);
    }),
  );
  await startTurn(body);
  expect(reconnectingAtResume).toEqual([true]);
  expect(liveMessageFor('msg_a')?.status).toBe('complete');
  expect(textOf(liveMessageFor('msg_a'))).toBe('Halo dunia');
  expect(getGenerationsState().byId.gen_1?.reconnecting).toBe(false);
});

test('a stream that drops again keeps resuming', async () => {
  const e = eventsFor('gen_1');
  let attempts = 0;
  server.use(
    http.post('/api/chat', () => sse([e.started(assistant)], { fail: true })),
    http.get('/api/generations/gen_1/stream', () => {
      attempts += 1;
      if (attempts === 1) return HttpResponse.error();
      const done = msg({ id: 'msg_a', status: 'complete', parts: [{ type: 'text', text: 'ok' }] });
      const r = eventsFor('gen_1', 3);
      return sse([r.snapshot(done), r.finished(done)]);
    }),
  );
  await startTurn(body);
  expect(attempts).toBe(2);
  expect(textOf(liveMessageFor('msg_a'))).toBe('ok');
});

test('errors before streaming reject', async () => {
  server.use(
    http.post('/api/chat', () =>
      HttpResponse.json(
        { error: { code: 'rate_limited', message: 'Too many messages. Wait a moment.' } },
        { status: 429 },
      ),
    ),
  );
  const err = await startTurn(body).catch((x: unknown) => x);
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).code).toBe('rate_limited');
});
