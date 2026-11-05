import type { ChatRequestBody, ConversationDetail, StreamEvent } from '@neotext/shared';
import { waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '../../../lib/api/client';
import { createQueryClient, qk } from '../../../lib/query';
import { getGenerationsState, liveMessageFor, resetGenerations } from '../../../state/generations';
import { eventsFor, msg, sseStream, summary, textOf } from '../../../test/chat-fixtures';
import { server } from '../../../test/msw';
import {
  newIdempotencyKey,
  RESUME_MAX_MS,
  STREAM_IDLE_MS,
  setStreamQueryClient,
  startTurn,
} from './stream-client';

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
    folderId: null,
    timeZone: 'Asia/Jakarta',
  },
};

const assistant = msg({ id: 'msg_a', status: 'streaming' });
const sse = (events: StreamEvent[], opts?: { fail?: boolean; hang?: boolean }) =>
  new HttpResponse(sseStream(events, opts), { headers: { 'Content-Type': 'text/event-stream' } });
const final = msg({
  id: 'msg_a',
  status: 'complete',
  parts: [{ type: 'text', text: 'Halo dunia' }],
});
const savedDetail = (): ConversationDetail => ({
  conversation: summary({ activeLeafId: 'msg_a' }),
  messages: [final],
});

let qc = createQueryClient();
const cached = () =>
  qc
    .getQueryData<ConversationDetail>(qk.conversation('cnv_1'))
    ?.messages.find((m) => m.id === 'msg_a');

/** Advances fake time in steps until `p` settles. */
async function advanceUntil(p: Promise<unknown>, maxMs: number, stepMs = 1000) {
  let settled = false;
  void p.finally(() => {
    settled = true;
  });
  for (let t = 0; t < maxMs && !settled; t += stepMs) await vi.advanceTimersByTimeAsync(stepMs);
  expect(settled).toBe(true);
}

beforeEach(() => {
  resetGenerations();
  qc = createQueryClient();
  setStreamQueryClient(qc);
  qc.setQueryData<ConversationDetail>(qk.conversation('cnv_1'), {
    conversation: summary({ activeLeafId: 'msg_a' }),
    messages: [assistant],
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('giving up after the time budget keeps the partial answer with a note', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const e = eventsFor('gen_1');
  let resumes = 0;
  server.use(
    http.post('/api/chat', () => sse([e.started(assistant), e.text('Ha')], { fail: true })),
    http.get('/api/generations/gen_1/stream', () => {
      resumes += 1;
      return HttpResponse.error();
    }),
    http.get('/api/conversations/cnv_1', () => HttpResponse.error()),
  );
  await advanceUntil(startTurn(body), RESUME_MAX_MS + 15_000);
  expect(resumes).toBeGreaterThan(5);
  const live = getGenerationsState().byMessage.msg_a;
  expect(textOf(live?.message)).toBe('Ha');
  expect(live?.lost).toBe(true);
  expect(live?.reconnecting).toBe(false);
  // The cache holds the partial text too, so nothing is lost when the live copy goes.
  expect(textOf(cached())).toBe('Ha');

  vi.useRealTimers();
  // The network is back: the first successful refetch replaces the live copy.
  server.use(http.get('/api/conversations/cnv_1', () => HttpResponse.json(savedDetail())));
  await qc.refetchQueries({ queryKey: qk.conversation('cnv_1') });
  await waitFor(() => expect(liveMessageFor('msg_a')).toBeUndefined());
  expect(cached()?.status).toBe('complete');
});

test('a resume 404 keeps the answer until the refetch lands', async () => {
  const e = eventsFor('gen_1');
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  server.use(
    http.post('/api/chat', () => sse([e.started(assistant), e.text('Ha')], { fail: true })),
    http.get('/api/generations/gen_1/stream', () =>
      HttpResponse.json(
        { error: { code: 'not_found', message: 'That answer is not generating any more.' } },
        { status: 404 },
      ),
    ),
    http.get('/api/conversations/cnv_1', async () => {
      await gate;
      return HttpResponse.json(savedDetail());
    }),
  );
  await startTurn(body);
  expect(textOf(liveMessageFor('msg_a'))).toBe('Ha');
  expect(textOf(cached())).toBe('Ha');
  release();
  await waitFor(() => expect(liveMessageFor('msg_a')).toBeUndefined());
  expect(cached()).toEqual(final);
});

test('a silent connection is dropped after the idle limit and resumed', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const e = eventsFor('gen_1');
  let resumes = 0;
  server.use(
    http.post('/api/chat', () => sse([e.started(assistant), e.text('Ha')], { hang: true })),
    http.get('/api/generations/gen_1/stream', () => {
      resumes += 1;
      const r = eventsFor('gen_1', 9);
      return sse([r.snapshot({ ...final, status: 'streaming' }), r.finished(final)]);
    }),
  );
  const done = startTurn(body);
  await vi.advanceTimersByTimeAsync(STREAM_IDLE_MS - 1000);
  expect(resumes).toBe(0);
  await advanceUntil(done, 10_000, 250);
  expect(resumes).toBe(1);
  expect(liveMessageFor('msg_a')?.status).toBe('complete');
});

test('a server that never sends headers is treated as a drop after the idle limit', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  let aborted = false;
  server.use(
    // Never answers; once the client gives up, the request ends quietly.
    http.post(
      '/api/chat',
      ({ request }) =>
        new Promise<Response>((resolve) => {
          request.signal.addEventListener('abort', () => {
            aborted = true;
            resolve(HttpResponse.error());
          });
        }),
    ),
  );
  let outcome: unknown = 'pending';
  const done = startTurn(body).then(
    () => 'resolved',
    (err: unknown) => err,
  );
  void done.then((v) => {
    outcome = v;
  });
  await vi.advanceTimersByTimeAsync(STREAM_IDLE_MS - 1000);
  expect(outcome).toBe('pending');
  await advanceUntil(done, 5000, 250);
  expect(aborted).toBe(true);
  expect(outcome).toBeInstanceOf(ApiError);
  expect(outcome).toMatchObject({
    code: 'network',
    message: 'The reply stopped before it finished. Try again.',
  });
});

test('the idle limit is 45 s, comfortably above the 15 s server ping', () => {
  expect(STREAM_IDLE_MS).toBe(45_000);
});

test('an error event after streaming began resumes instead of failing the answer', async () => {
  const e = eventsFor('gen_1');
  const seen: { status?: string; reconnecting?: boolean }[] = [];
  server.use(
    http.post('/api/chat', () =>
      sse([
        e.started(assistant),
        e.text('Ha'),
        {
          type: 'error',
          generationId: 'gen_1',
          seq: 0,
          code: 'internal',
          message: 'Stream failed.',
        },
      ]),
    ),
    http.get('/api/generations/gen_1/stream', () => {
      const live = getGenerationsState().byMessage.msg_a;
      seen.push({ status: live?.message.status, reconnecting: live?.reconnecting });
      const r = eventsFor('gen_1', 9);
      return sse([r.snapshot({ ...final, status: 'streaming' }), r.finished(final)]);
    }),
  );
  await startTurn(body);
  expect(seen).toEqual([{ status: 'streaming', reconnecting: true }]);
  expect(liveMessageFor('msg_a')).toEqual(final);
});

test('idempotency keys work where randomUUID is unavailable', () => {
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
    throw new TypeError('randomUUID needs a secure context');
  });
  const a = newIdempotencyKey();
  const b = newIdempotencyKey();
  expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(a).not.toBe(b);
});
