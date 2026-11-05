import fs from 'node:fs';
import path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Clock } from '../lib/clock';
import { createBackup, pruneBackups } from './backup';
import type { DbHandle } from './client';

export const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, '../../drizzle');

function journalCount(folder: string): number {
  const journal = JSON.parse(
    fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: unknown[] };
  return journal.entries.length;
}

function appliedCount(db: DbHandle): number {
  const has = db.raw
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'")
    .get();
  if (!has) return 0;
  const row = db.raw.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get() as {
    n: number;
  };
  return row.n;
}

export function countPendingMigrations(db: DbHandle, folder: string = MIGRATIONS_FOLDER): number {
  return Math.max(0, journalCount(folder) - appliedCount(db));
}

function hasUserData(db: DbHandle): boolean {
  const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
    name: string;
  }[];
  return tables
    .filter((t) => !t.name.startsWith('sqlite_') && !t.name.startsWith('__drizzle'))
    .some(
      (t) =>
        db.raw.prepare(`SELECT 1 FROM "${t.name.replaceAll('"', '""')}" LIMIT 1`).get() !==
        undefined,
    );
}

export async function runMigrations(
  db: DbHandle,
  opts: { folder?: string; backupDir: string; clock: Clock; keepPreMigration: number },
): Promise<{ applied: number; backupFile: string | null }> {
  const folder = opts.folder ?? MIGRATIONS_FOLDER;
  const pending = countPendingMigrations(db, folder);
  if (pending === 0) return { applied: 0, backupFile: null };

  let backupFile: string | null = null;
  if (hasUserData(db)) {
    backupFile = await createBackup(db, opts.backupDir, 'pre-migration', opts.clock);
    await pruneBackups(opts.backupDir, {
      scheduled: Number.MAX_SAFE_INTEGER,
      preMigration: opts.keepPreMigration,
    });
  }
  migrate(db.orm, { migrationsFolder: folder });
  return { applied: pending, backupFile };
}
