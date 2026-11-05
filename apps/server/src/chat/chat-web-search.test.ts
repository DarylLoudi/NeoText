import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { StreamEvent } from '@neotext/shared';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { type MockProvider, startMockProvider } from '../../test-support/mock-provider';
import { readEvents } from '../../test-support/sse-client';
import { fixtureFrames, textFrames } from '../../test-support/sse-frames';
import { authed, createTestApp, setupOwner, type TestApp } from '../../test-support/test-app';

let t: TestApp;
let mock: MockProvider;
let api: ReturnType<typeof authed>;
let searx: http.Server | null = null;
let searxUrl = '';

beforeEach(async () => {
  t = await createTestApp();
  mock = await startMockProvider();
  mock.models = ['m1'];
  api = authed(t, (await setupOwner(t)).cookie);
});
afterEach(async () => {
  await t.close();
  await mock.close();
  await new Promise<void>((r) => (searx ? searx.close(() => r()) : r()));
  searx = null;
});

async function createProvider(body: Record<string, unknown>) {
  const res = await api('/api/providers', { method: 'POST', body: JSON.stringify(body) });
  return ((await res.json()) as { provider: { id: string } }).provider.id;
}
const openRouter = () =>
  createProvider({
    kind: 'openrouter',
    name: 'OR',
    baseUrl: mock.url,
    apiKey: 'sk-or-test-1234567890',
  });
const custom = () => createProvider({ kind: 'openai-compatible', name: 'Mock', baseUrl: mock.url });
const searxng = (baseUrl: string) => createProvider({ kind: 'searxng', name: 'Searx', baseUrl });
const useBackend = (id: string) =>
  api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({ patch: { webSearch: { backendProviderId: id } } }),
  });

/** A SearXNG stand-in answering every request with two results. */
async function startSearx() {
  searx = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        results: [
          { url: 'https://a.test/x', title: 'First', content: 'one' },
          { url: 'https://b.test/y', title: 'Second', content: 'two' },
        ],
      }),
    );
  });
  await new Promise<void>((r) => searx?.listen(0, '127.0.0.1', r));
  searxUrl = `http://127.0.0.1:${((searx as http.Server).address() as AddressInfo).port}`;
}

async function turn(providerId: string, webSearch: boolean, text = 'harga btc?') {
  const res = await api('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      conversationId: null,
      parentId: null,
      userMessage: { text },
      targets: [{ providerId, modelId: 'm1' }],
      options: { webSearch },
    }),
  });
  return readEvents(res);
}
const sentBodies = () =>
  mock.requests
    .filter((r) => r.path === '/v1/chat/completions')
    .map(
      (r) => r.body as Record<string, unknown> & { messages: { role: string; content: string }[] },
    );
const toolTypes = (b: Record<string, unknown>) =>
  ((b.tools ?? []) as { type: string; function?: { name: string } }[]).map(
    (x) => x.function?.name ?? x.type,
  );
const activities = (evs: StreamEvent[]) =>
  evs.flatMap((e) => (e.type === 'activity' ? [e.kind] : []));

test('sources from OpenRouter annotations reach the client deduplicated', async () => {
  const orId = await openRouter();
  mock.enqueue({ frames: fixtureFrames('openrouter-search') });
  const evs = await turn(orId, true);
  const added = evs.flatMap((e) => (e.type === 'sources.added' ? e.sources : []));
  expect(added.map((s) => s.n)).toEqual([1, 2]);
  const fin = evs.find((e) => e.type === 'generation.finished');
  const parts = fin?.type === 'generation.finished' ? fin.message.parts : [];
  const last = parts.at(-1);
  expect(last?.type === 'sources' && last.sources).toHaveLength(2);
  const kinds = activities(evs);
  expect(kinds[0]).toBe('searching');
  expect(kinds.at(-1)).toBe('idle');
  const body = sentBodies()[0] as Record<string, unknown>;
  expect(body.plugins).toBeUndefined();
  expect(body.tools).toContainEqual({
    type: 'openrouter:web_search',
    parameters: { engine: 'parallel', mode: 'fast', max_results: 5 },
  });
  expect(body.max_tool_calls).toBe(3);
});

test('settings change the OpenRouter search parameters', async () => {
  await api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({
      patch: {
        webSearch: { engine: 'exa', maxResults: 8, maxSearchesPerTurn: 2, contextSize: 'high' },
      },
    }),
  });
  mock.enqueue({ frames: textFrames('ok') });
  await turn(await openRouter(), true);
  const body = sentBodies()[0] as Record<string, unknown>;
  expect(body.tools).toContainEqual({
    type: 'openrouter:web_search',
    // The saved mode is still the default 'fast', which Exa does not have, so it stays out.
    parameters: { engine: 'exa', max_results: 8, search_context_size: 'high' },
  });
  expect(body.max_tool_calls).toBe(2);
});

test('a backend gives a custom endpoint the app web_search tool', async () => {
  await useBackend(await searxng(mock.url));
  mock.enqueue({ frames: textFrames('ok') });
  await turn(await custom(), true);
  expect(toolTypes(sentBodies()[0] as Record<string, unknown>)).toContain('web_search');
  mock.reset();
  mock.enqueue({ frames: textFrames('ok') });
  await turn(await custom(), false);
  expect(toolTypes(sentBodies()[0] as Record<string, unknown>)).not.toContain('web_search');
});

test('OpenRouter with a backend sends the server tool only, never the app tool too', async () => {
  await useBackend(await searxng(mock.url));
  mock.enqueue({ frames: textFrames('ok') });
  await turn(await openRouter(), true);
  const types = toolTypes(sentBodies()[0] as Record<string, unknown>);
  expect(types).toContain('openrouter:web_search');
  expect(types).not.toContain('web_search');
});

/** An OpenRouter provider whose only model reports no tool support, models cached. */
async function noToolsProvider() {
  mock.modelsBody = JSON.stringify({
    data: [
      {
        id: 'm1',
        pricing: { prompt: '0.000001', completion: '0.000002' },
        supported_parameters: ['temperature'],
      },
    ],
  });
  const id = await openRouter();
  expect((await api(`/api/providers/${id}/models`)).status).toBe(200);
  return id;
}

test('a model without tools is not searched for ahead of the answer', async () => {
  await startSearx();
  await useBackend(await searxng(searxUrl));
  const id = await noToolsProvider();
  mock.enqueue({ frames: textFrames('Sekitar 78 ribu') });
  const evs = await turn(id, true);
  const body = sentBodies()[0];
  expect(body?.tools).toBeUndefined();
  expect(body?.messages.some((m) => m.content.includes('untrusted data'))).toBe(false);
  expect(evs.some((e) => e.type === 'sources.added')).toBe(false);
  expect(activities(evs)).toEqual([]);
});

test('GET /api/tools reports whether a usable search backend is chosen', async () => {
  const flag = async () =>
    ((await (await api('/api/tools')).json()) as { webSearchBackend: boolean }).webSearchBackend;
  expect(await flag()).toBe(false);
  await useBackend(await custom());
  expect(await flag()).toBe(false);
  const id = await searxng(mock.url);
  await useBackend(id);
  expect(await flag()).toBe(true);
  await api(`/api/providers/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled: false }) });
  expect(await flag()).toBe(false);
});

test('the web_search policy off turns OpenRouter search off too', async () => {
  await api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({ patch: { tools: { policies: { web_search: 'off' } } } }),
  });
  mock.enqueue({ frames: textFrames('ok') });
  await turn(await openRouter(), true);
  const body = sentBodies()[0] as Record<string, unknown>;
  expect(toolTypes(body)).not.toContain('openrouter:web_search');
  expect(body.max_tool_calls).toBeUndefined();
  expect(JSON.stringify(body.messages)).not.toContain('You can search the web.');
});
