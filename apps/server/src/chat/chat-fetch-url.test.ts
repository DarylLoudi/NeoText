import { afterEach, beforeEach, expect, test } from 'vitest';
import { type MockProvider, startMockProvider } from '../../test-support/mock-provider';
import { readEvents } from '../../test-support/sse-client';
import { textFrames } from '../../test-support/sse-frames';
import { authed, createTestApp, setupOwner, type TestApp } from '../../test-support/test-app';

let t: TestApp;
let mock: MockProvider;
let api: ReturnType<typeof authed>;
let providerId: string;

beforeEach(async () => {
  t = await createTestApp();
  mock = await startMockProvider();
  mock.models = ['m1'];
  const owner = await setupOwner(t);
  api = authed(t, owner.cookie);
  const res = await api('/api/providers', {
    method: 'POST',
    body: JSON.stringify({ kind: 'openai-compatible', name: 'Mock', baseUrl: mock.url }),
  });
  providerId = ((await res.json()) as { provider: { id: string } }).provider.id;
});
afterEach(async () => {
  await t.close();
  await mock.close();
});

/** Runs one turn and returns the body the provider received. */
async function sentBody(text: string, options: Record<string, unknown> = {}) {
  mock.enqueue({ frames: textFrames('Oke') });
  const res = await api('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      conversationId: null,
      parentId: null,
      userMessage: { text },
      targets: [{ providerId, modelId: 'm1' }],
      options,
    }),
  });
  await readEvents(res);
  const sent = mock.requests.find((r) => r.path === '/v1/chat/completions');
  return sent?.body as { tools?: { function: { name: string } }[] };
}

test('plain messages send only delegate_tasks; links offer fetch_url', async () => {
  const names = (b: Awaited<ReturnType<typeof sentBody>>) => b.tools?.map((x) => x.function.name);
  expect(names(await sentBody('halo'))).toEqual(['delegate_tasks']);
  mock.reset();
  const withLink = await sentBody('baca https://x.org');
  expect(names(withLink)).toEqual(['fetch_url', 'delegate_tasks']);
});

test('web search alone offers fetch_url', async () => {
  const body = await sentBody('cari berita', { webSearch: true });
  expect(body.tools?.map((tool) => tool.function.name)).toContain('fetch_url');
});

test('fetch_url is listed among the tools in settings', async () => {
  const res = await api('/api/tools');
  const list = (await res.json()) as { tools: { name: string; defaultPolicy: string }[] };
  expect(list.tools).toContainEqual(
    expect.objectContaining({ name: 'fetch_url', defaultPolicy: 'auto' }),
  );
});
