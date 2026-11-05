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
  api = authed(t, (await setupOwner(t)).cookie);
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

test('JSON answers are compressed for a client that takes it', async () => {
  // Enough chats for the list to pass the 1 KB compression threshold.
  for (let i = 0; i < 12; i++) {
    await api('/api/conversations', { method: 'POST', body: JSON.stringify({ title: `c${i}` }) });
  }
  const list = await api('/api/conversations', { headers: { 'accept-encoding': 'gzip' } });
  expect(list.headers.get('content-type')).toContain('application/json');
  expect(list.headers.get('content-encoding')).toBe('gzip');
  const body = list.body?.pipeThrough(new DecompressionStream('gzip'));
  expect(await new Response(body).json()).toHaveProperty('items');

  const plain = await api('/api/conversations');
  expect(plain.headers.get('content-encoding')).toBeNull();
});

test('the chat stream is never compressed', async () => {
  mock.enqueue({ frames: textFrames('Halo! ', 'Apa kabar?') });
  const res = await api('/api/chat', {
    method: 'POST',
    headers: { 'accept-encoding': 'gzip, deflate, br' },
    body: JSON.stringify({
      conversationId: null,
      parentId: null,
      userMessage: { text: 'Hai' },
      targets: [{ providerId, modelId: 'm1' }],
    }),
  });
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  expect(res.headers.get('content-encoding')).toBeNull();
  const events = await readEvents(res);
  expect(events.map((e) => e.type)).toContain('generation.finished');
});
