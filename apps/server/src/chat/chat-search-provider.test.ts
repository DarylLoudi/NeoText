import { afterEach, beforeEach, expect, test } from 'vitest';
import { type MockProvider, startMockProvider } from '../../test-support/mock-provider';
import { readEvents } from '../../test-support/sse-client';
import { textFrames } from '../../test-support/sse-frames';
import { authed, createTestApp, setupOwner, type TestApp } from '../../test-support/test-app';

let t: TestApp;
let mock: MockProvider;
let api: ReturnType<typeof authed>;
let llmId: string;
let searchId: string;

async function create(body: Record<string, unknown>) {
  const res = await api('/api/providers', { method: 'POST', body: JSON.stringify(body) });
  return ((await res.json()) as { provider: { id: string } }).provider.id;
}

beforeEach(async () => {
  t = await createTestApp();
  mock = await startMockProvider();
  mock.models = ['m1'];
  api = authed(t, (await setupOwner(t)).cookie);
  llmId = await create({ kind: 'openai-compatible', name: 'Mock', baseUrl: mock.url });
  searchId = await create({ kind: 'searxng', name: 'Searx', baseUrl: mock.url });
});
afterEach(async () => {
  await t.close();
  await mock.close();
});

const chat = (providerId: string) =>
  api('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      conversationId: null,
      parentId: null,
      userMessage: { text: 'halo' },
      targets: [{ providerId, modelId: 'm1' }],
      options: {},
    }),
  });

test('listing models of a search provider is empty, not a server error', async () => {
  const res = await api(`/api/providers/${searchId}/models`);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ models: [], stale: false, error: null });
  expect(mock.requests).toEqual([]);
});

test('a search provider cannot be chatted with', async () => {
  const res = await chat(searchId);
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: unknown }).error).toMatchObject({
    code: 'bad_request',
    message: 'That provider is for web search, not chat.',
  });
  expect(mock.requests.some((r) => r.path === '/v1/chat/completions')).toBe(false);
});

test('a title model on a search provider falls back to the turn model', async () => {
  await api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({
      patch: { chat: { titleModel: { providerId: searchId, modelId: 't1' } } },
    }),
  });
  mock.enqueue({ frames: textFrames('Jawaban') }, { frames: textFrames('Judul') });
  const evs = await readEvents(await chat(llmId));
  expect(evs.at(-1)).toMatchObject({ type: 'conversation.updated', title: 'Judul' });
  const models = mock.requests
    .filter((r) => r.path === '/v1/chat/completions')
    .map((r) => (r.body as { model: string }).model);
  expect(models).toEqual(['m1', 'm1']);
});
