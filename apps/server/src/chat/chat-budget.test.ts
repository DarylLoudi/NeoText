import type { StreamEvent } from '@neotext/shared';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { type MockProvider, startMockProvider } from '../../test-support/mock-provider';
import { readEvents } from '../../test-support/sse-client';
import { chunk, DONE, finish, usage } from '../../test-support/sse-frames';
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

const setBudget = (budget: Record<string, unknown>) =>
  api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({ patch: { budget, chat: { autoTitle: false } } }),
  });
const chat = (options: Record<string, unknown> = {}) =>
  api('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      conversationId: null,
      parentId: null,
      userMessage: { text: 'Hai' },
      targets: [{ providerId, modelId: 'm1' }],
      options,
    }),
  });
const costly = (cost: number) => [
  chunk({ content: 'Halo' }),
  finish('stop'),
  usage({ prompt_tokens: 12, completion_tokens: 5, total_tokens: 17, cost }),
  DONE,
];
const finishedOf = (evs: StreamEvent[]) =>
  evs.find((e): e is Extract<StreamEvent, { type: 'generation.finished' }> => {
    return e.type === 'generation.finished';
  });

test('budget blocks the next turn, not the current one', async () => {
  await setBudget({ dailyUsd: 0.001, hardStop: true });
  mock.enqueue({ frames: costly(0.002) });
  const first = finishedOf(await readEvents(await chat()));
  expect(first?.message.status).toBe('complete');
  const res = await chat();
  expect(res.status).toBe(402);
  expect(((await res.json()) as { error: unknown }).error).toMatchObject({
    code: 'quota_exceeded',
    message:
      "You've reached your daily budget of $0.001. Raise it in Usage, or wait for the next period.",
  });
  expect(mock.requests.filter((r) => r.path === '/v1/chat/completions')).toHaveLength(1);
});

test('without a hard stop the turn goes on past the limit', async () => {
  await setBudget({ dailyUsd: 0.001, hardStop: false });
  mock.enqueue({ frames: costly(0.002) }, { frames: costly(0.002) });
  await readEvents(await chat());
  const res = await chat();
  expect(res.status).toBe(200);
  expect(finishedOf(await readEvents(res))?.message.status).toBe('complete');
});

test('the day follows the time zone the turn sends', async () => {
  // The test clock is at 2026-11-03T02:00Z. Spend recorded at 20:00Z on the 2nd is
  // yesterday in UTC but today in Jakarta (+7).
  t.c.repos.usage.insert({
    userId: ((await (await api('/api/auth/me')).json()) as { user: { id: string } }).user.id,
    conversationId: null,
    messageId: null,
    providerId,
    modelId: 'm1',
    kind: 'chat',
    usage: {
      promptTokens: 1,
      completionTokens: 1,
      reasoningTokens: 0,
      cachedTokens: 0,
      costUsd: 0.5,
      webSearchRequests: 0,
    },
    createdAt: Date.parse('2026-11-02T20:00:00Z'),
  });
  await setBudget({ dailyUsd: 0.5, hardStop: true });
  expect((await chat({ timeZone: 'Asia/Jakarta' })).status).toBe(402);
  mock.enqueue({ frames: costly(0) });
  const res = await chat({ timeZone: 'UTC' });
  expect(res.status).toBe(200);
  await readEvents(res);
});

test('an unknown time zone is refused with 400, not a server error', async () => {
  await setBudget({ dailyUsd: 0.5, hardStop: true });
  const res = await chat({ timeZone: 'Nowhere/Land' });
  expect(res.status).toBe(400);
  const { error } = (await res.json()) as {
    error: { code: string; details: { path: string[]; message: string }[] };
  };
  expect(error.code).toBe('validation_failed');
  expect(error.details).toContainEqual({
    path: ['options', 'timeZone'],
    message: 'Unknown time zone. Send an IANA name such as Asia/Jakarta.',
  });
  expect(mock.requests.filter((r) => r.path === '/v1/chat/completions')).toHaveLength(0);
});

test('a blocked turn does no tool work first', async () => {
  await setBudget({ dailyUsd: 0.001, hardStop: true });
  mock.enqueue({ frames: costly(0.002) });
  await readEvents(await chat());
  let listed = 0;
  t.c.tools.add(() => {
    listed += 1;
    return [];
  });
  const res = await chat({ webSearch: true });
  expect(res.status).toBe(402);
  expect(listed).toBe(0);
});
