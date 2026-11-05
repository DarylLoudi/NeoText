import type { ConversationDetail, StreamEvent } from '@neotext/shared';
import { waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createQueryClient, qk } from '../../../lib/query';
import {
  getGenerationsState,
  ingestEvents,
  liveMessageFor,
  resetGenerations,
} from '../../../state/generations';
import { eventsFor, msg, sseStream, summary, textOf } from '../../../test/chat-fixtures';
import { server } from '../../../test/msw';
import { RESUME_MAX_MS, resumeGeneration, setStreamQueryClient } from './stream-client';

const streaming = msg({
  id: 'msg_a',
  status: 'streaming',
  parts: [{ type: 'text', text: 'Ha' }],
});
const final = msg({
  id: 'msg_a',
  status: 'complete',
  parts: [{ type: 'text', text: 'Halo dunia' }],
});
const sse = (events: StreamEvent[], opts?: { fail?: boolean }) =>
  new HttpResponse(sseStream(events, opts), { headers: { 'Content-Type': 'text/event-stream' } });
const errorEvent = (seq: number): StreamEvent => ({
  type: 'error',
  generationId: 'gen_1',
  seq,
  code: 'internal',
  message: 'Stream failed.',
});

/** Advances fake time in steps until `p` settles; returns the time it took. */
async function advanceUntil(p: Promise<unknown>, maxMs: number, stepMs = 250): Promise<number> {
  let settled = false;
  void p.finally(() => {
    settled = true;
  });
  let waited = 0;
  while (waited < maxMs && !settled) {
    await vi.advanceTimersByTimeAsync(stepMs);
    waited += stepMs;
  }
  expect(settled).toBe(true);
  return waited;
}

let qc = createQueryClient();
beforeEach(() => {
  resetGenerations();
  qc = createQueryClient();
  setStreamQueryClient(qc);
  qc.setQueryData<ConversationDetail>(qk.conversation('cnv_1'), {
    conversation: summary({ activeLeafId: 'msg_a' }),
    messages: [streaming],
  });
});
afterEach(() => {
  vi.useRealTimers();
});

test('resuming after a reload follows the snapshot to the end', async () => {
  const r = eventsFor('gen_1');
  server.use(
    http.get('/api/generations/gen_1/stream', () =>
      sse([r.snapshot(streaming), r.text(' dunia'), r.finished(final)]),
    ),
  );
  const seen: string[] = [];
  await resumeGeneration('gen_1', 'cnv_1', { onEvent: (e) => seen.push(e.type) });
  expect(seen).toEqual(['generation.snapshot', 'text.delta', 'generation.finished']);
  expect(liveMessageFor('msg_a')).toEqual(final);
  expect(getGenerationsState().byMessage.msg_a?.reconnecting).toBe(false);
});

test('an error event in a resumed stream is followed by another resume that finishes', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const r = eventsFor('gen_1');
  const seenAtRetry: (boolean | undefined)[] = [];
  let connections = 0;
  server.use(
    http.get('/api/generations/gen_1/stream', () => {
      connections += 1;
      if (connections === 1) return sse([r.snapshot(streaming), errorEvent(2)]);
      seenAtRetry.push(getGenerationsState().byMessage.msg_a?.reconnecting);
      const next = eventsFor('gen_1', 9);
      return sse([next.snapshot(streaming), next.finished(final)]);
    }),
  );
  await advanceUntil(resumeGeneration('gen_1', 'cnv_1'), 5000);
  expect(connections).toBe(2);
  expect(seenAtRetry).toEqual([true]);
  expect(liveMessageFor('msg_a')).toEqual(final);
});

test('resuming gives up after the time budget and keeps the partial answer', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  let connections = 0;
  server.use(
    http.get('/api/generations/gen_1/stream', () => {
      connections += 1;
      return HttpResponse.error();
    }),
    http.get('/api/conversations/cnv_1', () => HttpResponse.error()),
  );
  // Seed the live copy the way a first snapshot would.
  ingestEvents([eventsFor('gen_1').snapshot(streaming)]);
  const waited = await advanceUntil(
    resumeGeneration('gen_1', 'cnv_1'),
    RESUME_MAX_MS + 15_000,
    1000,
  );
  expect(waited).toBeGreaterThanOrEqual(RESUME_MAX_MS);
  expect(waited).toBeLessThanOrEqual(RESUME_MAX_MS + 6000);
  expect(connections).toBeGreaterThan(5);
  const live = getGenerationsState().byMessage.msg_a;
  expect(textOf(live?.message)).toBe('Ha');
  expect(live?.lost).toBe(true);
  expect(live?.reconnecting).toBe(false);
  expect(qc.getQueryData<ConversationDetail>(qk.conversation('cnv_1'))?.messages[0]?.status).toBe(
    'streaming',
  );
});

test('resuming a generation the server no longer has gives up at once', async () => {
  server.use(
    http.get('/api/generations/gen_1/stream', () =>
      HttpResponse.json(
        { error: { code: 'not_found', message: 'That answer is not generating any more.' } },
        { status: 404 },
      ),
    ),
    http.get('/api/conversations/cnv_1', () =>
      HttpResponse.json({
        conversation: summary({ activeLeafId: 'msg_a' }),
        messages: [final],
      } satisfies ConversationDetail),
    ),
  );
  ingestEvents([eventsFor('gen_1').snapshot(streaming)]);
  await resumeGeneration('gen_1', 'cnv_1');
  // Until the refetch lands the partial answer stays.
  expect(textOf(qc.getQueryData<ConversationDetail>(qk.conversation('cnv_1'))?.messages[0])).toBe(
    'Ha',
  );
  await waitFor(() => expect(liveMessageFor('msg_a')).toBeUndefined());
  expect(qc.getQueryData<ConversationDetail>(qk.conversation('cnv_1'))?.messages[0]).toEqual(final);
});
