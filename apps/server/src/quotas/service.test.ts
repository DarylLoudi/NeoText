import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  addUser,
  authed,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';

let t: TestApp;
let admin: ReturnType<typeof authed>;
let userId: string;
let sharedId: string;
let ownId: string;

const DAY = 86_400_000;
const NOV_3 = Date.UTC(2026, 10, 3, 2, 0, 0);

const mkProvider = async (api: typeof admin, body: Record<string, unknown>) => {
  const res = await api('/api/providers', {
    method: 'POST',
    body: JSON.stringify({ kind: 'openai-compatible', baseUrl: 'http://localhost:9', ...body }),
  });
  const out = (await res.json()) as { provider: { id: string } };
  if (!out.provider) throw new Error(JSON.stringify(out));
  return out.provider.id;
};
/** Records one chat call the way the runner does. */
const spend = (providerId: string, costUsd: number | null, who = userId) =>
  t.c.repos.usage.insert({
    userId: who,
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
      costUsd,
      webSearchRequests: 0,
    },
    createdAt: t.clock.now(),
  });

beforeEach(async () => {
  t = await createTestApp();
  admin = authed(t, (await setupOwner(t, { mode: 'community' })).cookie);
  const sinta = await addUser(t, 'sinta', 'admin');
  userId = sinta.userId;
  sharedId = await mkProvider(admin, { name: 'Lab', shared: true });
  ownId = await mkProvider(authed(t, sinta.cookie), { name: 'Mine' });
});
afterEach(async () => {
  await t.close();
});

test('null means unlimited', () => {
  expect(t.c.quotas.effective(userId)).toEqual({ dailyUsd: null, monthlyUsd: null });
  spend(sharedId, 50);
  expect(() => t.c.quotas.assertWithin(userId)).not.toThrow();
  expect(t.c.quotas.status(userId)).toMatchObject({ dailySpent: 50, exhausted: false });
});

test('user limit overrides the instance default', () => {
  t.c.instance.set('default_quota', { dailyUsd: 1, monthlyUsd: 10 });
  expect(t.c.quotas.effective(userId)).toEqual({ dailyUsd: 1, monthlyUsd: 10 });
  t.c.quotas.setForUser(userId, { dailyUsd: 5, monthlyUsd: null });
  expect(t.c.quotas.effective(userId)).toEqual({ dailyUsd: 5, monthlyUsd: null });
  t.c.quotas.setForUser(userId, null);
  expect(t.c.quotas.effective(userId)).toEqual({ dailyUsd: 1, monthlyUsd: 10 });
});

test('limit reached blocks, with the daily budget named first', () => {
  t.c.quotas.setForUser(userId, { dailyUsd: 0.001, monthlyUsd: 0.5 });
  spend(sharedId, 0.002);
  expect(() => t.c.quotas.assertWithin(userId)).toThrowError(
    expect.objectContaining({
      code: 'quota_exceeded',
      status: 402,
      message:
        "You've used your daily budget on shared models ($0.001). It resets tomorrow (UTC). You can also add your own key in Settings → Providers.",
      details: { period: 'daily', amountUsd: 0.001 },
    }),
  );
});

test('only spend on shared providers counts, and unknown costs add nothing', () => {
  t.c.quotas.setForUser(userId, { dailyUsd: 1, monthlyUsd: null });
  spend(ownId, 9);
  spend(sharedId, null);
  expect(t.c.quotas.status(userId)).toMatchObject({ dailySpent: 0, exhausted: false });
  spend(sharedId, 0.4);
  spend(sharedId, 0.2);
  expect(t.c.quotas.status(userId).dailySpent).toBeCloseTo(0.6);
});

test('spend of other members does not count', async () => {
  const other = await addUser(t, 'budi');
  t.c.quotas.setForUser(userId, { dailyUsd: 1, monthlyUsd: null });
  spend(sharedId, 5, other.userId);
  expect(t.c.quotas.status(userId).dailySpent).toBe(0);
});

test('the day and month roll over in UTC', () => {
  // 2026-11-03T02:00Z; a limit on each.
  t.c.quotas.setForUser(userId, { dailyUsd: 1, monthlyUsd: 3 });
  spend(sharedId, 1.5);
  expect(() => t.c.quotas.assertWithin(userId)).toThrowError(/daily budget/);
  t.clock.set(NOV_3 + DAY);
  expect(() => t.c.quotas.assertWithin(userId)).not.toThrow();
  expect(t.c.quotas.status(userId)).toMatchObject({ dailySpent: 0, monthlySpent: 1.5 });
  t.c.quotas.setForUser(userId, { dailyUsd: 2, monthlyUsd: 3 });
  spend(sharedId, 1.6);
  expect(() => t.c.quotas.assertWithin(userId)).toThrowError(
    expect.objectContaining({
      message: expect.stringContaining(
        'monthly budget on shared models ($3.00). It resets next month',
      ),
    }),
  );
  // Still blocked on the last day of the month; allowed on the 1st (UTC).
  t.clock.set(Date.UTC(2026, 10, 30, 23, 59, 59));
  expect(() => t.c.quotas.assertWithin(userId)).toThrowError(/monthly/);
  t.clock.set(Date.UTC(2026, 11, 1, 0, 0, 0));
  expect(() => t.c.quotas.assertWithin(userId)).not.toThrow();
});

test('status reports what is left', () => {
  t.c.quotas.setForUser(userId, { dailyUsd: 2, monthlyUsd: 10 });
  spend(sharedId, 0.75);
  expect(t.c.quotas.status(userId)).toEqual({
    dailyUsd: 2,
    monthlyUsd: 10,
    dailySpent: 0.75,
    monthlySpent: 0.75,
    exhausted: false,
  });
  spend(sharedId, 1.25);
  expect(t.c.quotas.status(userId).exhausted).toBe(true);
});

test('spend on a shared provider that was deleted still counts', async () => {
  t.c.quotas.setForUser(userId, { dailyUsd: 1, monthlyUsd: null });
  spend(sharedId, 0.6);
  expect((await admin(`/api/providers/${sharedId}`, { method: 'DELETE' })).status).toBeLessThan(
    300,
  );
  // A fresh service state: the cached figure must not be what keeps this right.
  t.clock.advance(60_000);
  expect(t.c.quotas.status(userId).dailySpent).toBeCloseTo(0.6);
});

test('a direct database edit shows up once the 30 s cache has lapsed', () => {
  t.c.quotas.setForUser(userId, { dailyUsd: 1, monthlyUsd: null });
  expect(t.c.quotas.status(userId).dailySpent).toBe(0);
  t.c.db.raw
    .prepare(
      `INSERT INTO usage_events (id, user_id, provider_id, model_id, kind, prompt_tokens, completion_tokens,
        reasoning_tokens, cached_tokens, cost_usd, web_search_requests, created_at, shared)
       VALUES ('use_x', ?, ?, 'm1', 'chat', 1, 1, 0, 0, 0.9, 0, ?, 1)`,
    )
    .run(userId, sharedId, t.clock.now());
  expect(t.c.quotas.status(userId).dailySpent).toBe(0);
  t.clock.advance(31_000);
  expect(t.c.quotas.status(userId).dailySpent).toBe(0.9);
});
