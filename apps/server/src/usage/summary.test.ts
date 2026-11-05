import { UsageSummaryQuerySchema } from '@neotext/shared';
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  addUser,
  authed,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';
import type { UsageEventInsert } from './repo';
import { summarizeUsage } from './summary';

let t: TestApp;
let userId: string;
let api: ReturnType<typeof authed>;
beforeEach(async () => {
  t = await createTestApp();
  const owner = await setupOwner(t);
  userId = owner.user.id;
  api = authed(t, owner.cookie);
});
afterEach(() => t.close());

const at = (iso: string) => Date.parse(iso);
const DAY = 86_400_000;

function add(over: Partial<UsageEventInsert> & { cost?: number | null; tokens?: number[] } = {}) {
  const { cost = 0.01, tokens = [10, 5], ...rest } = over;
  t.c.repos.usage.insert({
    userId,
    conversationId: null,
    messageId: null,
    providerId: 'prv_a',
    modelId: 'm1',
    kind: 'chat',
    usage: {
      promptTokens: tokens[0] ?? 0,
      completionTokens: tokens[1] ?? 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      costUsd: cost,
      webSearchRequests: 0,
    },
    createdAt: at('2026-11-03T12:00:00Z'),
    ...rest,
  });
}

const query = (over: Partial<{ from: number; to: number; tz: string; by: 'day' | 'model' }>) =>
  UsageSummaryQuerySchema.parse({
    from: over.from ?? at('2026-11-01T00:00:00Z'),
    to: over.to ?? at('2026-11-10T00:00:00Z'),
    groupBy: over.by ?? 'day',
    timeZone: over.tz ?? 'UTC',
  });

test('days follow the time zone', () => {
  add({ createdAt: at('2026-11-03T18:30:00Z') });
  const day = (tz: string) => summarizeUsage(t.c.db, userId, query({ tz })).rows.map((r) => r.key);
  expect(day('UTC')).toEqual(['2026-11-03']);
  expect(day('Asia/Jakarta')).toEqual(['2026-11-04']);
  expect(day('Asia/Kolkata')).toEqual(['2026-11-04']);
  // 18:29Z is 23:59 in Kolkata: a half-hour zone splits inside a 15-minute bucket edge.
  add({ createdAt: at('2026-11-03T18:29:00Z') });
  expect(summarizeUsage(t.c.db, userId, query({ tz: 'Asia/Kolkata' })).rows).toMatchObject([
    { key: '2026-11-03', requests: 1 },
    { key: '2026-11-04', requests: 1 },
  ]);
});

test('days are listed in order with their sums', () => {
  add({ createdAt: at('2026-11-05T01:00:00Z'), cost: 0.5, tokens: [100, 50] });
  add({ createdAt: at('2026-11-02T01:00:00Z'), cost: 0.25, tokens: [10, 5] });
  add({ createdAt: at('2026-11-02T03:00:00Z'), cost: 0.25, tokens: [10, 5] });
  const s = summarizeUsage(t.c.db, userId, query({}));
  expect(s.rows).toEqual([
    {
      key: '2026-11-02',
      costUsd: 0.5,
      promptTokens: 20,
      completionTokens: 10,
      requests: 2,
      unknownCostRequests: 0,
    },
    {
      key: '2026-11-05',
      costUsd: 0.5,
      promptTokens: 100,
      completionTokens: 50,
      requests: 1,
      unknownCostRequests: 0,
    },
  ]);
  expect(s).toMatchObject({
    totalCostUsd: 1,
    totalPromptTokens: 120,
    totalCompletionTokens: 60,
    requests: 3,
  });
});

test('groups by model and sorts by cost', () => {
  add({ providerId: 'prv_a', modelId: 'cheap', cost: 0.01 });
  add({ providerId: 'prv_a', modelId: 'dear', cost: 0.4 });
  add({ providerId: 'prv_b', modelId: 'dear', cost: 0.2 });
  add({ providerId: 'prv_a', modelId: 'dear', cost: 0.1 });
  const rows = summarizeUsage(t.c.db, userId, query({ by: 'model' })).rows;
  expect(rows.map((r) => [r.key, r.requests])).toEqual([
    ['prv_a|dear', 2],
    ['prv_b|dear', 1],
    ['prv_a|cheap', 1],
  ]);
  expect(rows[0]?.costUsd).toBeCloseTo(0.5);
});

test('unknown costs are counted, not treated as zero spend', () => {
  add({ cost: 0.2 });
  add({ cost: null });
  const s = summarizeUsage(t.c.db, userId, query({}));
  expect(s.unknownCostRequests).toBe(1);
  expect(s.requests).toBe(2);
  expect(s.totalCostUsd).toBe(0.2);
  add({ modelId: 'local', cost: null });
  const rows = summarizeUsage(t.c.db, userId, query({ by: 'model' })).rows;
  expect(rows.find((r) => r.key === 'prv_a|local')).toMatchObject({
    costUsd: 0,
    requests: 1,
    unknownCostRequests: 1,
  });
  expect(rows.find((r) => r.key === 'prv_a|m1')).toMatchObject({ unknownCostRequests: 1 });
});

test('web searches count every kind, including the search backend rows', () => {
  add();
  t.c.repos.usage.insert({
    userId,
    conversationId: null,
    messageId: null,
    providerId: 'prv_or',
    modelId: 'm1',
    kind: 'chat',
    usage: {
      promptTokens: 1,
      completionTokens: 1,
      reasoningTokens: 0,
      cachedTokens: 0,
      costUsd: 0.01,
      webSearchRequests: 2,
    },
    createdAt: at('2026-11-03T12:00:00Z'),
  });
  t.c.repos.usage.insert({
    userId,
    conversationId: null,
    messageId: null,
    providerId: 'prv_searx',
    modelId: 'searxng',
    kind: 'search',
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      costUsd: null,
      webSearchRequests: 1,
    },
    createdAt: at('2026-11-03T12:00:00Z'),
  });
  expect(summarizeUsage(t.c.db, userId, query({})).webSearches).toBe(3);
});

test('the range bounds are kept: from inclusive, to exclusive', () => {
  add({ createdAt: at('2026-11-01T00:00:00Z') });
  add({ createdAt: at('2026-11-10T00:00:00Z') });
  add({ createdAt: at('2026-10-31T23:59:59Z') });
  expect(summarizeUsage(t.c.db, userId, query({})).requests).toBe(1);
});

test('other users are not included', async () => {
  const other = await addUser(t, 'tamu');
  add({ userId: other.userId, cost: 9 });
  add({ cost: 0.1 });
  const s = summarizeUsage(t.c.db, userId, query({}));
  expect(s.requests).toBe(1);
  expect(s.totalCostUsd).toBe(0.1);
});

test('ranges over 400 days are refused', async () => {
  const from = at('2025-01-01T00:00:00Z');
  const ok = await api(
    `/api/usage/summary?from=${from}&to=${from + 400 * DAY}&groupBy=day&timeZone=UTC`,
  );
  expect(ok.status).toBe(200);
  const res = await api(
    `/api/usage/summary?from=${from}&to=${from + 401 * DAY}&groupBy=day&timeZone=UTC`,
  );
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe('validation_failed');
  const zone = await api(`/api/usage/summary?from=0&to=1000&groupBy=day&timeZone=Mars/Base`);
  expect(zone.status).toBe(400);
});

test('the summary route answers for the signed-in user only', async () => {
  add({ cost: 0.3 });
  const res = await api(
    `/api/usage/summary?from=${at('2026-11-01T00:00:00Z')}&to=${at('2026-11-10T00:00:00Z')}&groupBy=model&timeZone=Asia/Jakarta`,
  );
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(await res.json()).toMatchObject({
    totalCostUsd: 0.3,
    rows: [{ key: 'prv_a|m1', requests: 1 }],
  });
  const anon = await t.app.request('/api/usage/summary?from=0&to=1&groupBy=day&timeZone=UTC');
  expect(anon.status).toBe(401);
});
