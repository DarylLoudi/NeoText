import { expect, test, vi } from 'vitest';
import type { HttpClient } from '../../net/http-client';
import type { ToolContext } from '../types';
import { createFetchSlots, FETCH_URL_CONCURRENCY, fetchUrlTool } from './fetch-url';

/** A client whose pages answer only when the test lets them, counting fetches in flight. */
function gatedClient() {
  let inFlight = 0;
  let peak = 0;
  const gates: Array<() => void> = [];
  const client: HttpClient = {
    fetch: vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => gates.push(resolve));
      inFlight -= 1;
      return new Response('page text', { headers: { 'content-type': 'text/plain' } });
    }),
    close: async () => {},
  };
  return { client, peak: () => peak, gates, inFlight: () => inFlight };
}

const ctxWith = (http: HttpClient, fetchSlots = createFetchSlots()): ToolContext => ({
  userId: 'usr_1',
  timeZone: 'UTC',
  signal: new AbortController().signal,
  http,
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as never,
  fetchSlots,
});

const settle = () => new Promise((r) => setTimeout(r, 10));

test(`one generation runs at most ${FETCH_URL_CONCURRENCY} fetches at once; the rest queue`, async () => {
  const g = gatedClient();
  const ctx = ctxWith(g.client);
  const runs = Array.from({ length: 10 }, (_, i) =>
    fetchUrlTool.execute({ url: `https://a.example/${i}` }, ctx),
  );
  await settle();
  expect(g.inFlight()).toBe(FETCH_URL_CONCURRENCY);
  while (g.gates.length > 0 || g.inFlight() > 0) {
    g.gates.shift()?.();
    await settle();
  }
  const results = await Promise.all(runs);
  expect(results.every((r) => r.ok)).toBe(true);
  expect(g.peak()).toBe(FETCH_URL_CONCURRENCY);
});

test('a fetch stopped while it waits for a slot never starts', async () => {
  const g = gatedClient();
  const slots = createFetchSlots();
  const ctx = ctxWith(g.client, slots);
  const first = Array.from({ length: FETCH_URL_CONCURRENCY }, (_, i) =>
    fetchUrlTool.execute({ url: `https://a.example/${i}` }, ctx),
  );
  const stopper = new AbortController();
  const waiting = fetchUrlTool.execute(
    { url: 'https://a.example/late' },
    { ...ctx, signal: stopper.signal },
  );
  await settle();
  stopper.abort();
  while (g.gates.length > 0) {
    g.gates.shift()?.();
    await settle();
  }
  await Promise.all(first);
  expect(await waiting).toEqual({ ok: false, error: 'This request was stopped.' });
  expect(g.client.fetch).toHaveBeenCalledTimes(FETCH_URL_CONCURRENCY);
});

test('separate generations do not share slots', async () => {
  const g = gatedClient();
  const a = ctxWith(g.client);
  const b = ctxWith(g.client);
  const runs = [
    ...Array.from({ length: FETCH_URL_CONCURRENCY }, () =>
      fetchUrlTool.execute({ url: 'https://a.example/' }, a),
    ),
    fetchUrlTool.execute({ url: 'https://b.example/' }, b),
  ];
  await settle();
  expect(g.inFlight()).toBe(FETCH_URL_CONCURRENCY + 1);
  while (g.gates.length > 0) {
    g.gates.shift()?.();
    await settle();
  }
  await Promise.all(runs);
});
