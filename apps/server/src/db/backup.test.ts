import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createFakeClock } from '../lib/clock';
import { createLogger } from '../lib/logger';
import { createBackup, pruneBackups, startBackupSchedule } from './backup';
import { type DbHandle, openDatabase } from './client';

let dir: string;
let db: DbHandle;
const clock = createFakeClock(Date.UTC(2026, 10, 3, 2, 5, 9));
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neotext bak-'));
  db = openDatabase(path.join(dir, 'neotext.db'));
  db.raw.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  db.raw.exec("INSERT INTO t (v) VALUES ('a'), ('b'), ('c')");
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('backup is a readable copy', async () => {
  const file = await createBackup(db, path.join(dir, 'back ups'), 'manual', clock);
  expect(path.basename(file)).toMatch(/^neotext-\d{8}-\d{6}-manual\.db$/);
  expect(path.basename(file)).toBe('neotext-20261103-020509-manual.db');
  const copy = new Database(file, { readonly: true });
  expect(copy.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 3 });
  copy.close();
});

test('prune keeps the newest per label', async () => {
  const bdir = path.join(dir, 'b');
  fs.mkdirSync(bdir);
  const names = [
    'neotext-20261101-000000-scheduled.db',
    'neotext-20261102-000000-scheduled.db',
    'neotext-20261103-000000-scheduled.db',
    'neotext-20261104-000000-scheduled.db',
    'neotext-20261101-000000-pre-migration.db',
    'neotext-20261102-000000-pre-migration.db',
    'neotext-20261103-000000-pre-migration.db',
    'neotext-20261103-000000-manual.db',
    'unrelated.txt',
  ];
  for (const n of names) fs.writeFileSync(path.join(bdir, n), 'x');
  const removed = await pruneBackups(bdir, { scheduled: 2, preMigration: 1 });
  expect(removed.map((p) => path.basename(p)).sort()).toEqual([
    'neotext-20261101-000000-pre-migration.db',
    'neotext-20261101-000000-scheduled.db',
    'neotext-20261102-000000-pre-migration.db',
    'neotext-20261102-000000-scheduled.db',
  ]);
  expect(fs.readdirSync(bdir)).toHaveLength(5);
});

test('schedule creates a backup on the interval and stops cleanly', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  try {
    const bdir = path.join(dir, 'sched');
    const s = startBackupSchedule(db, {
      dir: bdir,
      intervalHours: 1,
      keepScheduled: 2,
      keepPreMigration: 1,
      clock,
      log: createLogger({ logLevel: 'silent', env: 'test' }),
    });
    await vi.advanceTimersByTimeAsync(3600_000);
    await vi.waitFor(() => {
      expect(fs.readdirSync(bdir).filter((f) => f.endsWith('-scheduled.db'))).toHaveLength(1);
    });
    s.stop();
    await vi.advanceTimersByTimeAsync(7200_000);
    expect(fs.readdirSync(bdir).filter((f) => f.endsWith('-scheduled.db'))).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

test('the schedule runs its housekeeping before each backup', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  try {
    const bdir = path.join(dir, 'tidy');
    const seen: number[] = [];
    const s = startBackupSchedule(db, {
      dir: bdir,
      intervalHours: 1,
      keepScheduled: 2,
      keepPreMigration: 1,
      clock,
      log: createLogger({ logLevel: 'silent', env: 'test' }),
      beforeBackup: () => {
        seen.push(fs.existsSync(bdir) ? fs.readdirSync(bdir).length : 0);
      },
    });
    await vi.advanceTimersByTimeAsync(3600_000);
    await vi.waitFor(() => expect(fs.readdirSync(bdir)).toHaveLength(1));
    s.stop();
    // It ran once, before the first backup file existed.
    expect(seen).toEqual([0]);
  } finally {
    vi.useRealTimers();
  }
});
