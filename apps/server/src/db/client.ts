import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type Orm = BetterSQLite3Database<typeof schema>;

export interface DbHandle {
  orm: Orm;
  raw: Database.Database;
  file: string;
  close(): void;
}

export function openDatabase(file: string): DbHandle {
  const raw = new Database(file);
  if (file !== ':memory:') raw.pragma('journal_mode = WAL');
  raw.pragma('synchronous = FULL');
  raw.pragma('foreign_keys = ON');
  raw.pragma('busy_timeout = 5000');
  raw.pragma('temp_store = MEMORY');
  raw.pragma('cache_size = -32000');
  const orm = drizzle(raw, { schema });
  return {
    orm,
    raw,
    file,
    close: () => {
      if (raw.open) raw.close();
    },
  };
}
