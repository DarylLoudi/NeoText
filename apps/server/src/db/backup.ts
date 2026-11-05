import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Clock } from '../lib/clock';
import type { Logger } from '../lib/logger';
import type { DbHandle } from './client';

export type BackupLabel = 'scheduled' | 'pre-migration' | 'manual';

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

const BACKUP_NAME = /^neotext-\d{8}-\d{6}-(scheduled|pre-migration)\.db$/;

function stamp(ms: number): string {
  const iso = new Date(ms).toISOString(); // 2026-11-03T02:05:09.000Z
  return `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 19).replaceAll(':', '')}`;
}

async function removeDbFiles(file: string): Promise<void> {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    await fs.rm(file + suffix, { force: true });
  }
}

export async function createBackup(
  db: DbHandle,
  dir: string,
  label: BackupLabel,
  clock: Clock,
): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `neotext-${stamp(clock.now())}-${label}.db`);
  await db.raw.backup(file);
  let result: unknown;
  try {
    const copy = new Database(file);
    try {
      result = copy.pragma('quick_check', { simple: true });
    } finally {
      copy.close();
    }
  } catch (err) {
    result = err instanceof Error ? err.message : String(err);
  }
  if (result !== 'ok') {
    await removeDbFiles(file);
    throw new BackupError(
      `The backup failed its integrity check (${String(result)}). The partial copy was deleted; check the disk and try again.`,
    );
  }
  return file;
}

export async function pruneBackups(
  dir: string,
  keep: { scheduled: number; preMigration: number },
): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const removed: string[] = [];
  const groups = [
    { label: 'scheduled', keep: keep.scheduled },
    { label: 'pre-migration', keep: keep.preMigration },
  ];
  for (const g of groups) {
    const files = names.filter((n) => BACKUP_NAME.exec(n)?.[1] === g.label).sort();
    for (const name of files.slice(0, Math.max(0, files.length - g.keep))) {
      const full = path.join(dir, name);
      await removeDbFiles(full);
      removed.push(full);
    }
  }
  return removed;
}

export function startBackupSchedule(
  db: DbHandle,
  opts: {
    dir: string;
    intervalHours: number;
    keepScheduled: number;
    keepPreMigration: number;
    clock: Clock;
    log: Logger;
    /** Housekeeping that runs before each backup, so the copy leaves out what it deletes. */
    beforeBackup?: () => void;
  },
): { stop(): void } {
  let running = false;
  let stopped = false;
  const timer = setInterval(() => {
    if (running || stopped || !db.raw.open) return;
    running = true;
    try {
      opts.beforeBackup?.();
    } catch (err) {
      opts.log.error({ err }, 'housekeeping before backup failed');
    }
    createBackup(db, opts.dir, 'scheduled', opts.clock)
      .then((file) => {
        opts.log.info({ file }, 'scheduled backup created');
        return pruneBackups(opts.dir, {
          scheduled: opts.keepScheduled,
          preMigration: opts.keepPreMigration,
        });
      })
      .catch((err: unknown) => {
        opts.log.error({ err }, 'scheduled backup failed');
      })
      .finally(() => {
        running = false;
      });
  }, opts.intervalHours * 3600_000);
  timer.unref();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
