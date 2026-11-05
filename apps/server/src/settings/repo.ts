import type { SettingsHistoryItem } from '@neotext/shared';
import type { DbHandle } from '../db/client';

export interface SettingsRow {
  userId: string;
  version: number;
  schemaVersion: number;
  data: Buffer;
  updatedAt: number;
}

export interface SettingsRepo {
  get(userId: string): SettingsRow | null;
  upsert(row: SettingsRow): void;
  insertHistory(h: {
    userId: string;
    version: number;
    schemaVersion: number;
    data: Buffer;
    reason: SettingsHistoryItem['reason'];
    createdAt: number;
  }): void;
  lastHistory(userId: string): { version: number; createdAt: number; reason: string } | null;
  listHistory(userId: string, limit: number): SettingsHistoryItem[];
  getHistory(userId: string, version: number): { data: Buffer; schemaVersion: number } | null;
  pruneHistory(userId: string, keep: number): void;
  transaction<T>(fn: () => T): T;
}

export function createSettingsRepo(db: DbHandle): SettingsRepo {
  const { raw } = db;
  const getRow = raw.prepare(
    `select user_id as userId, version, schema_version as schemaVersion, data,
            updated_at as updatedAt from user_settings where user_id = ?`,
  );
  const upsertRow = raw.prepare(
    `insert into user_settings (user_id, version, schema_version, data, updated_at)
     values (@userId, @version, @schemaVersion, @data, @updatedAt)
     on conflict(user_id) do update set version = excluded.version,
       schema_version = excluded.schema_version, data = excluded.data,
       updated_at = excluded.updated_at`,
  );
  const insertHist = raw.prepare(
    `insert into user_settings_history (user_id, version, schema_version, data, reason, created_at)
     values (@userId, @version, @schemaVersion, @data, @reason, @createdAt)`,
  );
  const lastHist = raw.prepare(
    `select version, created_at as createdAt, reason from user_settings_history
     where user_id = ? order by id desc limit 1`,
  );
  const listHist = raw.prepare(
    `select version, created_at as createdAt, reason from user_settings_history
     where user_id = ? order by id desc limit ?`,
  );
  const getHist = raw.prepare(
    `select data, schema_version as schemaVersion from user_settings_history
     where user_id = ? and version = ? order by id desc limit 1`,
  );
  const prune = raw.prepare(
    `delete from user_settings_history where user_id = @userId and reason <> 'quarantine' and id not in (
       select id from user_settings_history where user_id = @userId and reason <> 'quarantine'
         order by id desc limit @keep)`,
  );
  return {
    get: (userId) => (getRow.get(userId) as SettingsRow | undefined) ?? null,
    upsert: (row) => {
      upsertRow.run(row);
    },
    insertHistory: (h) => {
      insertHist.run(h);
    },
    lastHistory: (userId) =>
      (lastHist.get(userId) as
        | { version: number; createdAt: number; reason: string }
        | undefined) ?? null,
    listHistory: (userId, limit) => listHist.all(userId, limit) as SettingsHistoryItem[],
    getHistory: (userId, version) =>
      (getHist.get(userId, version) as { data: Buffer; schemaVersion: number } | undefined) ?? null,
    pruneHistory: (userId, keep) => {
      prune.run({ userId, keep });
    },
    transaction: (fn) => raw.transaction(fn).immediate(),
  };
}
