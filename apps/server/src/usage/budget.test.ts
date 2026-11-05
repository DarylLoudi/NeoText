import { afterEach, beforeEach, expect, test } from 'vitest';
import { authed, createTestApp, setupOwner, type TestApp } from '../../test-support/test-app';
import { AppError } from '../http/errors';
import { assertBudget, budgetStatus } from './budget';

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
const NOW = at('2026-11-20T10:00:00Z');

function spend(cost: number | null, iso: string) {
  t.c.repos.usage.insert({
    userId,
    conversationId: null,
    messageId: null,
    providerId: 'prv_a',
    modelId: 'm1',
    kind: 'chat',
    usage: {
      promptTokens: 1,
      completionTokens: 1,
      reasoningTokens: 0,
      cachedTokens: 0,
      costUsd: cost,
      webSearchRequests: 0,
    },
    createdAt: at(iso),
  });
}

const budget = (over: Partial<{ dailyUsd: number | null; monthlyUsd: number | null }> = {}) => ({
  dailyUsd: 0.5,
  monthlyUsd: null,
  warnAtPercent: 80,
  hardStop: true,
  ...over,
});

test('status per period', () => {
  spend(0.4, '2026-11-20T01:00:00Z');
  spend(0.3, '2026-11-19T12:00:00Z'); // yesterday: this month, not today
  spend(5, '2026-10-31T12:00:00Z'); // last month
  spend(null, '2026-11-20T02:00:00Z'); // unknown cost adds nothing
  expect(budgetStatus(t.c.db, userId, budget(), NOW, 'UTC')).toEqual({
    dailySpent: 0.4,
    monthlySpent: expect.closeTo(0.7),
    dailyLimit: 0.5,
    monthlyLimit: null,
    warnAtPercent: 80,
    hardStop: true,
    blocked: false,
  });
  spend(0.1, '2026-11-20T03:00:00Z');
  expect(budgetStatus(t.c.db, userId, budget(), NOW, 'UTC').blocked).toBe(true);
});

test('periods follow the time zone', () => {
  // 18:00Z on the 19th is already the 20th in Jakarta (+7).
  spend(0.2, '2026-11-19T18:00:00Z');
  expect(budgetStatus(t.c.db, userId, budget(), NOW, 'UTC').dailySpent).toBe(0);
  expect(budgetStatus(t.c.db, userId, budget(), NOW, 'Asia/Jakarta').dailySpent).toBe(0.2);
  // 20:00Z on 31 October is 1 November in Jakarta.
  spend(1, '2026-10-31T20:00:00Z');
  expect(budgetStatus(t.c.db, userId, budget(), NOW, 'UTC').monthlySpent).toBeCloseTo(0.2);
  expect(budgetStatus(t.c.db, userId, budget(), NOW, 'Asia/Jakarta').monthlySpent).toBeCloseTo(1.2);
});

test('the monthly limit blocks too', () => {
  spend(3, '2026-11-02T12:00:00Z');
  const s = budgetStatus(t.c.db, userId, budget({ dailyUsd: null, monthlyUsd: 3 }), NOW, 'UTC');
  expect(s.blocked).toBe(true);
  expect(() =>
    assertBudget(t.c.db, userId, budget({ dailyUsd: null, monthlyUsd: 3 }), NOW, 'UTC'),
  ).toThrowError(
    "You've reached your monthly budget of $3.00. Raise it in Usage, or wait for the next period.",
  );
});

test('float sums meet the limit they add up to', () => {
  // 0.1 + 0.2 + 0.2 is 0.5000000000000001 and 0.1 + 0.7 is 0.7999999999999999 in floats.
  spend(0.1, '2026-11-20T01:00:00Z');
  spend(0.2, '2026-11-20T02:00:00Z');
  spend(0.2, '2026-11-20T03:00:00Z');
  expect(budgetStatus(t.c.db, userId, budget(), NOW, 'UTC').blocked).toBe(true);
  spend(0.1, '2026-11-10T01:00:00Z');
  spend(0.7, '2026-11-11T01:00:00Z');
  const monthly = budget({ dailyUsd: null, monthlyUsd: 1.3 });
  expect(budgetStatus(t.c.db, userId, monthly, NOW, 'UTC').blocked).toBe(true);
  expect(() => assertBudget(t.c.db, userId, monthly, NOW, 'UTC')).toThrowError(/monthly/);
});

test('no hard stop never blocks', () => {
  spend(10, '2026-11-20T01:00:00Z');
  const soft = { ...budget({ monthlyUsd: 1 }), hardStop: false };
  expect(budgetStatus(t.c.db, userId, soft, NOW, 'UTC').blocked).toBe(false);
  expect(() => assertBudget(t.c.db, userId, soft, NOW, 'UTC')).not.toThrow();
});

test('a reached limit throws quota_exceeded with the budget in the message', () => {
  spend(0.002, '2026-11-20T01:00:00Z');
  let err: unknown;
  try {
    assertBudget(t.c.db, userId, budget({ dailyUsd: 0.001 }), NOW, 'UTC');
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(AppError);
  expect(err).toMatchObject({
    code: 'quota_exceeded',
    status: 402,
    message:
      "You've reached your daily budget of $0.001. Raise it in Usage, or wait for the next period.",
    // So the web can word it in the user's language.
    details: { period: 'daily', limitUsd: 0.001 },
  });
});

test('GET /api/usage/budget reads the settings and the time zone', async () => {
  // The test clock is at 2026-11-03T02:00Z; 18:00Z the day before is the 3rd in Jakarta.
  spend(0.2, '2026-11-02T18:00:00Z');
  await api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({ patch: { budget: { dailyUsd: 1, hardStop: true } } }),
  });
  const read = async (q: string) => (await api(`/api/usage/budget${q}`)).json();
  expect(await read('')).toMatchObject({ dailySpent: 0, dailyLimit: 1, blocked: false });
  expect(await read('?timeZone=Asia/Jakarta')).toMatchObject({ dailySpent: 0.2 });
  expect((await api('/api/usage/budget?timeZone=Nowhere/Land')).status).toBe(400);
});
