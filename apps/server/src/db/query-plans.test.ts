import { randomBytes } from 'node:crypto';
import { ListQuerySchema } from '@neotext/shared';
import type Database from 'better-sqlite3';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { seedConversations } from '../../test-support/seed';
import { createTestApp, setupOwner, type TestApp } from '../../test-support/test-app';
import { summarizeUsage } from '../usage/summary';

// The schema here is whatever the migrations build today (createTestApp runs them all), so new
// tables and indexes are covered without listing them.

interface Query {
  sql: string;
  params: unknown[];
}

const RUNNING = new Set(['all', 'get', 'run', 'iterate']);
const CHAINING = new Set(['raw', 'pluck', 'expand', 'safeIntegers']);

/** The statements `fn` runs, with their parameters, as Drizzle hands them to better-sqlite3. */
function capture(raw: Database.Database, fn: () => unknown): Query[] {
  const seen: Query[] = [];
  const prepare = raw.prepare;
  raw.prepare = ((source: string) => {
    const stmt = prepare.call(raw, source);
    const proxy: Database.Statement = new Proxy(stmt, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (typeof value !== 'function') return value;
        if (RUNNING.has(String(key))) {
          return (...args: unknown[]) => {
            seen.push({ sql: source, params: args });
            return value.apply(target, args);
          };
        }
        if (CHAINING.has(String(key))) {
          return (...args: unknown[]) => {
            value.apply(target, args);
            return proxy;
          };
        }
        return value.bind(target);
      },
    });
    return proxy;
  }) as typeof raw.prepare;
  try {
    fn();
  } finally {
    raw.prepare = prepare;
  }
  return seen.filter((q) => /^\s*select\b/i.test(q.sql));
}

function planOf(raw: Database.Database, q: Query): string {
  const rows = raw.prepare(`EXPLAIN QUERY PLAN ${q.sql}`).all(...q.params) as { detail: string }[];
  return rows.map((r) => r.detail).join(' | ');
}

let t: TestApp;
let userId: string;
let conversationId: string;
const dek = randomBytes(32);
const queries = new Map<string, Query[]>();
const DAY = 86_400_000;

beforeAll(async () => {
  t = await createTestApp();
  userId = (await setupOwner(t)).user.id;
  const now = t.clock.now();
  const ids = seedConversations(t.c, userId, dek, { count: 5000, messagesEach: 4, now });
  conversationId = ids[0] ?? '';
  const pin = t.c.db.raw.prepare(
    'UPDATE conversations SET pinned = 1, pin_position = ? WHERE id = ?',
  );
  for (const [i, id] of ids.slice(0, 20).entries()) pin.run(`a${String(i).padStart(2, '0')}`, id);
  t.c.db.raw.transaction(() => {
    for (let i = 0; i < 20_000; i++) {
      t.c.repos.usage.insert({
        userId,
        conversationId: null,
        messageId: null,
        providerId: 'prv_x',
        modelId: 'mock/alpha',
        kind: 'chat',
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          reasoningTokens: 0,
          cachedTokens: 0,
          costUsd: 0.001,
          webSearchRequests: 0,
        },
        createdAt: now - i * 10 * 60_000, // one every ten minutes: about 140 days
      });
    }
  })();
  // No ANALYZE: the app never runs it, so these are the plans a real instance gets.

  const { conversations, messages } = t.c.repos;
  const raw = t.c.db.raw;
  const list = (scope: 'recent' | 'pinned') =>
    capture(raw, () => conversations.list(userId, dek, ListQuerySchema.parse({ scope })));
  queries.set('recent list', list('recent'));
  queries.set('pinned list', list('pinned'));
  queries.set(
    'messages of a conversation',
    capture(raw, () => messages.listForConversation(conversationId, dek)),
  );
  queries.set(
    'usage by user and time',
    capture(raw, () =>
      summarizeUsage(t.c.db, userId, {
        from: now - 30 * DAY,
        to: now,
        timeZone: 'UTC',
        groupBy: 'day',
      }),
    ),
  );
}, 120_000);

afterAll(async () => {
  await t.close();
});

test.each([
  ['recent list'],
  ['pinned list'],
  ['messages of a conversation'],
  ['usage by user and time'],
])('%s uses an index', (name) => {
  const captured = queries.get(name) ?? [];
  expect(captured.length).toBeGreaterThan(0);
  for (const q of captured) {
    const plan = planOf(t.c.db.raw, q);
    expect(plan, q.sql).toMatch(/USING (COVERING )?INDEX/);
    expect(plan, q.sql).not.toMatch(/SCAN (conversations|messages|usage_events)\b(?! USING)/);
  }
});

test('a page from 5,000 conversations is quick', () => {
  const slack = Number(process.env.PERF_SLACK) || 1;
  const q = ListQuerySchema.parse({ scope: 'recent' });
  const runs: number[] = [];
  let first = t.c.repos.conversations.list(userId, dek, q);
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    first = t.c.repos.conversations.list(userId, dek, q);
    runs.push(performance.now() - start);
  }
  expect(first.items).toHaveLength(50);
  expect(first.nextCursor).not.toBeNull();
  // The best of five: one slow run on a busy machine says nothing about the query.
  expect(Math.min(...runs)).toBeLessThan(50 * slack);
});
