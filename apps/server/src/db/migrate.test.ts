import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createFakeClock } from '../lib/clock';
import { type DbHandle, openDatabase } from './client';
import { countPendingMigrations, MIGRATIONS_FOLDER, runMigrations } from './migrate';

let dir: string;
let db: DbHandle;
const clock = createFakeClock();
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neotext mig-'));
  db = openDatabase(path.join(dir, 'neotext.db'));
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const opts = () => ({ backupDir: path.join(dir, 'backups'), clock, keepPreMigration: 5 });

test('fresh database applies all migrations without a backup', async () => {
  expect(countPendingMigrations(db)).toBeGreaterThanOrEqual(1);
  const r = await runMigrations(db, opts());
  expect(r.applied).toBeGreaterThanOrEqual(1);
  expect(r.backupFile).toBeNull();
  expect(countPendingMigrations(db)).toBe(0);
  const tables = db.raw
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '%drizzle%' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as { name: string }[];
  expect(tables.map((t) => t.name).sort()).toEqual(
    [
      'agent_chunks',
      'agent_files',
      'agents',
      'attachments',
      'audit_events',
      'conversations',
      'favicon_cache',
      'folders',
      'instance_meta',
      'invites',
      'mcp_servers',
      'messages',
      'model_cache',
      'presets',
      'providers',
      'quotas',
      'sessions',
      'user_settings',
      'usage_events',
      'user_settings_history',
      'users',
    ].sort(),
  );
});

test('second run applies nothing', async () => {
  await runMigrations(db, opts());
  const r = await runMigrations(db, opts());
  expect(r.applied).toBe(0);
  expect(r.backupFile).toBeNull();
});

test('pending migration on a non-empty database is preceded by a backup', async () => {
  const folder = path.join(dir, 'drizzle copy');
  fs.cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
  await runMigrations(db, { ...opts(), folder });
  db.raw
    .prepare("INSERT INTO instance_meta (key, value, updated_at) VALUES ('mode', '\"solo\"', 1)")
    .run();

  fs.writeFileSync(
    path.join(folder, '0001_extra.sql'),
    'CREATE TABLE extra_t (id INTEGER PRIMARY KEY);',
  );
  const journalFile = path.join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
  journal.entries.push({
    idx: journal.entries.length,
    version: journal.entries[0].version,
    when: journal.entries[journal.entries.length - 1].when + 1000,
    tag: '0001_extra',
    breakpoints: true,
  });
  fs.writeFileSync(journalFile, JSON.stringify(journal));

  expect(countPendingMigrations(db, folder)).toBe(1);
  const r = await runMigrations(db, { ...opts(), folder });
  expect(r.applied).toBe(1);
  expect(r.backupFile).not.toBeNull();
  expect(fs.existsSync(r.backupFile as string)).toBe(true);
  expect(r.backupFile).toMatch(/-pre-migration\.db$/);

  const copy = new Database(r.backupFile as string, { readonly: true });
  expect(copy.prepare('SELECT COUNT(*) AS n FROM instance_meta').get()).toEqual({ n: 1 });
  expect(copy.prepare("SELECT name FROM sqlite_master WHERE name='extra_t'").get()).toBeUndefined();
  copy.close();
  expect(db.raw.prepare("SELECT name FROM sqlite_master WHERE name='extra_t'").get()).toBeTruthy();
});
