import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { StreamEvent } from '@neotext/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { type MockProvider, startMockProvider } from '../../test-support/mock-provider';
import { readEvents } from '../../test-support/sse-client';
import { chunk, DONE, finish, textFrames } from '../../test-support/sse-frames';
import { authed, createTestApp, setupOwner, type TestApp } from '../../test-support/test-app';
import { usageEvents } from '../db/schema';

let t: TestApp;
let mock: MockProvider;
let api: ReturnType<typeof authed>;
let searx: http.Server;
let searxUrl = '';
let searches = 0;

beforeEach(async () => {
  t = await createTestApp();
  mock = await startMockProvider();
  mock.models = ['m1'];
  api = authed(t, (await setupOwner(t)).cookie);
  searches = 0;
  searx = http.createServer((_req, res) => {
    searches += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ results: [{ url: 'https://a.test/x', title: 'A', content: 'a' }] }));
  });
  await new Promise<void>((r) => searx.listen(0, '127.0.0.1', r));
  searxUrl = `http://127.0.0.1:${(searx.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await t.close();
  await mock.close();
  await new Promise<void>((r) => searx.close(() => r()));
});

async function createProvider(body: Record<string, unknown>) {
  const res = await api('/api/providers', { method: 'POST', body: JSON.stringify(body) });
  return ((await res.json()) as { provider: { id: string } }).provider.id;
}
async function useSearx() {
  const id = await createProvider({ kind: 'searxng', name: 'Searx', baseUrl: searxUrl });
  await api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({ patch: { webSearch: { backendProviderId: id } } }),
  });
  return id;
}
async function turn(providerId: string) {
  const res = await api('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      conversationId: null,
      parentId: null,
      userMessage: { text: 'harga btc?' },
      targets: [{ providerId, modelId: 'm1' }],
      options: { webSearch: true },
    }),
  });
  return readEvents(res);
}
const searchRows = () =>
  t.c.db.orm.select().from(usageEvents).where(eq(usageEvents.kind, 'search')).all();
const finished = (evs: StreamEvent[]) =>
  evs.find((e): e is Extract<StreamEvent, { type: 'generation.finished' }> => {
    return e.type === 'generation.finished';
  });

test('each app web_search call writes one search usage row', async () => {
  const searchId = await useSearx();
  const llmId = await createProvider({ kind: 'openai-compatible', name: 'M', baseUrl: mock.url });
  const call = { index: 0, id: 'call_1', type: 'function' };
  mock.enqueue(
    {
      frames: [
        chunk({
          tool_calls: [{ ...call, function: { name: 'web_search', arguments: '{"query":"btc"}' } }],
        }),
        finish('tool_calls'),
        DONE,
      ],
    },
    { frames: textFrames('Sekitar 78 ribu') },
  );
  const evs = await turn(llmId);
  const fin = finished(evs);
  expect(fin?.message.status).toBe('complete');
  expect(searches).toBe(1);
  expect(searchRows()).toEqual([
    expect.objectContaining({
      providerId: searchId,
      modelId: 'searxng',
      conversationId: fin?.message.conversationId,
      messageId: fin?.message.id,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: null,
      webSearchRequests: 1,
    }),
  ]);
});

test('a pre-search writes one search usage row', async () => {
  const searchId = await useSearx();
  mock.modelsBody = JSON.stringify({
    data: [{ id: 'm1', pricing: { prompt: '0', completion: '0' }, supported_parameters: [] }],
  });
  const orId = await createProvider({
    kind: 'openrouter',
    name: 'OR',
    baseUrl: mock.url,
    apiKey: 'sk-or-test-1234567890',
  });
  expect((await api(`/api/providers/${orId}/models`)).status).toBe(200);
  mock.enqueue({ frames: textFrames('Jawaban') });
  await turn(orId);
  expect(searches).toBe(1);
  expect(searchRows()).toMatchObject([{ providerId: searchId, webSearchRequests: 1 }]);
});
