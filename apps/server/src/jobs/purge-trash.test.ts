import { newId } from '@neotext/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  authContextFor,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';
import type { AuthContext } from '../http/env';
import { startPurgeJob, TRASH_RETENTION_MS } from './purge-trash';

const DAY = 86_400_000;
let t: TestApp;
let auth: AuthContext;
beforeEach(async () => {
  t = await createTestApp();
  auth = authContextFor(t, (await setupOwner(t)).cookie);
});
afterEach(async () => {
  await t.close();
});

function trashed(title: string, deletedAt: number): string {
  const id = newId('cnv');
  t.c.repos.conversations.insert(
    { id, userId: auth.userId, folderId: null, title, createdAt: deletedAt - DAY },
    auth.dek,
  );
  t.c.repos.messages.insert(
    {
      id: newId('msg'),
      conversationId: id,
      userId: auth.userId,
      parentId: null,
      role: 'user',
      status: 'complete',
      parts: [{ type: 'text', text: 'hello' }],
      providerId: null,
      modelId: null,
      createdAt: deletedAt - DAY,
    },
    auth.dek,
  );
  t.c.repos.conversations.softDelete(auth.userId, id, deletedAt);
  return id;
}

const count = (table: string, id: string) =>
  (
    t.c.db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE conversation_id = ?`).get(id) as {
      n: number;
    }
  ).n;
const exists = (id: string) =>
  (
    t.c.db.raw.prepare('SELECT COUNT(*) AS n FROM conversations WHERE id = ?').get(id) as {
      n: number;
    }
  ).n === 1;

test('purges only what is over 30 days old', () => {
  const now = t.clock.now();
  const day29 = trashed('keep', now - 29 * DAY);
  const day31 = trashed('drop', now - 31 * DAY);
  const purged: string[][] = [];
  const job = startPurgeJob({
    conversations: t.c.repos.conversations,
    clock: t.clock,
    log: t.c.log,
    onPurged: (ids) => purged.push(ids),
    schedule: () => () => {},
  });
  job.stop();
  expect(purged).toEqual([[day31]]);
  expect(exists(day29)).toBe(true);
  expect(exists(day31)).toBe(false);
  expect(count('messages', day31)).toBe(0);
  expect(count('messages', day29)).toBe(1);
});

test('runs again on the timer and stops when asked', () => {
  const now = t.clock.now();
  let tick: () => void = () => {};
  let interval = 0;
  let stopped = false;
  const purged: string[][] = [];
  const job = startPurgeJob({
    conversations: t.c.repos.conversations,
    clock: t.clock,
    log: t.c.log,
    onPurged: (ids) => purged.push(ids),
    schedule: (fn, ms) => {
      tick = fn;
      interval = ms;
      return () => {
        stopped = true;
      };
    },
  });
  expect(interval).toBe(DAY);
  expect(purged).toEqual([]);
  const old = trashed('later', now - TRASH_RETENTION_MS + DAY);
  tick();
  expect(exists(old)).toBe(true);
  t.clock.advance(2 * DAY);
  tick();
  expect(purged).toEqual([[old]]);
  job.stop();
  expect(stopped).toBe(true);
});

test('logs counts and never titles, and survives a failing hook', () => {
  const now = t.clock.now();
  trashed('Secret thesis plan', now - 40 * DAY);
  const info = vi.fn();
  const error = vi.fn();
  const log = { ...t.c.log, info, error } as typeof t.c.log;
  startPurgeJob({
    conversations: t.c.repos.conversations,
    clock: t.clock,
    log,
    onPurged: () => {
      throw new Error('boom');
    },
    schedule: () => () => {},
  }).stop();
  expect(JSON.stringify(info.mock.calls)).not.toContain('Secret');
  expect(info).toHaveBeenCalledWith({ purged: 1 }, expect.any(String));
  expect(error).toHaveBeenCalledWith(expect.anything(), 'purge hook failed');
  expect(error).not.toHaveBeenCalledWith(expect.anything(), 'trash purge failed');
});

test('sweeps unsent uploads every run, even when no chat is purged, and survives a failure', () => {
  const ticks: (() => void)[] = [];
  const cutoffs: number[] = [];
  let fail = true;
  const job = startPurgeJob({
    conversations: t.c.repos.conversations,
    clock: t.clock,
    log: t.c.log,
    purgeOrphans: (olderThan) => {
      cutoffs.push(olderThan);
      if (fail) throw new Error('disk gone');
      return 0;
    },
    schedule: (fn) => {
      ticks.push(fn);
      return () => {};
    },
  });
  fail = false;
  t.clock.advance(DAY);
  ticks[0]?.();
  job.stop();
  expect(cutoffs).toEqual([t.clock.now() - 2 * DAY, t.clock.now() - DAY]);
});
