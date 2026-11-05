import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createTestApp } from '../../test-support/test-app';
import { createAuditLog } from '../audit/audit';
import { createAuthService } from '../auth/service';
import { createSessionStore } from '../auth/sessions';
import { createUsersRepo } from '../auth/users-repo';
import { loadConfig } from '../config/env';
import { createInstanceMetaRepo } from '../instance/meta';
import { createFakeClock } from '../lib/clock';
import { createSettingsRepo } from '../settings/repo';
import { createSettingsService } from '../settings/service';
import { type DbHandle, openDatabase } from './client';
import { countPendingMigrations, MIGRATIONS_FOLDER, runMigrations } from './migrate';

const PASSWORD = 'correct horse battery';
let dir: string;
let dbs: DbHandle[];
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neotext upgrade-'));
  dbs = [];
});
afterEach(() => {
  for (const db of dbs) if (db.raw.open) db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const open = (file: string): DbHandle => {
  const db = openDatabase(file);
  dbs.push(db);
  return db;
};

/** A copy of the real migrations folder whose journal stops after the first release. */
function firstReleaseFolder(): string {
  const folder = path.join(dir, 'first release');
  fs.cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
  const journalFile = path.join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8')) as {
    entries: { tag: string }[];
  };
  const dropped = journal.entries.slice(1);
  journal.entries = journal.entries.slice(0, 1);
  fs.writeFileSync(journalFile, JSON.stringify(journal));
  for (const e of dropped) fs.rmSync(path.join(folder, `${e.tag}.sql`));
  return folder;
}

test('every migration applies in order on a fresh database', async () => {
  const db = open(path.join(dir, 'fresh.db'));
  const pending = countPendingMigrations(db);
  expect(pending).toBeGreaterThan(1);
  const r = await runMigrations(db, {
    backupDir: path.join(dir, 'fresh-backups'),
    clock: createFakeClock(),
    keepPreMigration: 5,
  });
  expect(r).toEqual({ applied: pending, backupFile: null });
  expect(countPendingMigrations(db)).toBe(0);
});

test('upgrade from the first schema keeps data readable', async () => {
  const clock = createFakeClock();
  const dataDir = path.join(dir, 'data');
  fs.mkdirSync(dataDir);
  const dbFile = path.join(dataDir, 'neotext.db');
  const backupDir = path.join(dataDir, 'backups');
  const folder = firstReleaseFolder();
  const config = loadConfig(
    {
      NODE_ENV: 'test',
      NEOTEXT_ARGON2_MEMORY_KIB: '1024',
      NEOTEXT_ARGON2_PASSES: '1',
      NEOTEXT_PUBLIC_URL: 'http://localhost:3420',
      NEOTEXT_DATA_DIR: dataDir,
    },
    dir,
  );

  // The first release: only 0000_init exists. Wire the services that release shipped.
  const old = open(dbFile);
  const first = await runMigrations(old, { folder, backupDir, clock, keepPreMigration: 5 });
  expect(first).toEqual({ applied: 1, backupFile: null });
  const tables = old.raw
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'")
    .all();
  expect(tables).toHaveLength(0);

  const instance = createInstanceMetaRepo(old, clock);
  const audit = createAuditLog(old, clock);
  const users = createUsersRepo(old, clock);
  const sessions = createSessionStore(old, clock);
  const auth = createAuthService({
    db: old,
    users,
    sessions,
    instance,
    audit,
    config,
    clock,
    instanceKey: Buffer.alloc(32),
  });
  const settings = createSettingsService({
    repo: createSettingsRepo(old),
    clock,
    audit,
    log: { warn() {}, error() {}, info() {}, debug() {} } as never,
  });
  const setup = await auth.setup({ username: 'daryl', password: PASSWORD, mode: 'personal' }, null);
  const dek = sessions.resolve(setup.token)?.dek;
  if (!dek) throw new Error('setup did not create a session');
  settings.patch(setup.user.id, dek, { appearance: { theme: 'dark' } });
  old.close();

  // The upgrade: the current migrations run against that database file.
  const db = open(dbFile);
  expect(countPendingMigrations(db)).toBeGreaterThanOrEqual(1);
  const upgraded = await runMigrations(db, { backupDir, clock, keepPreMigration: 5 });
  expect(upgraded.applied).toBeGreaterThanOrEqual(1);
  expect(countPendingMigrations(db)).toBe(0);
  expect(upgraded.backupFile).not.toBeNull();
  expect(fs.existsSync(upgraded.backupFile as string)).toBe(true);
  db.close();

  // The app boots on the upgraded data directory.
  const t = await createTestApp({ dataDir });
  try {
    const login = await t.c.auth.login({ username: 'daryl', password: PASSWORD }, null);
    expect(login.user.id).toBe(setup.user.id);
    const session = t.c.sessions.resolve(login.token);
    if (!session) throw new Error('login did not create a session');
    const read = t.c.settings.get(setup.user.id, session.dek);
    expect(read.settings.appearance.theme).toBe('dark');

    const auth2 = {
      userId: setup.user.id,
      username: 'daryl',
      role: 'admin' as const,
      sessionId: session.sessionId,
      dek: session.dek,
    };
    expect(t.c.conversations.list(auth2, { scope: 'recent', limit: 50 }).items).toEqual([]);
    const created = t.c.conversations.create(auth2, { title: 'after the upgrade' });
    const listed = t.c.conversations.list(auth2, { scope: 'recent', limit: 50 }).items;
    expect(listed.map((c) => c.id)).toEqual([created.id]);
  } finally {
    await t.close();
  }
});
