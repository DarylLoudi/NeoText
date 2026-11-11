import type { JsonObject } from '@neotext/shared';
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';

/** One outbox entry. `seq` is its enqueue order, shared with entries that never got stored. */
export interface OutboxRecord {
  seq: number;
  patch: JsonObject;
}

/** Browser-local storage of one user: the settings outbox, the settings cache and drafts. */
export interface Persistence {
  getKV<T>(key: string): Promise<T | undefined>;
  setKV(key: string, value: unknown): Promise<void>;
  deleteKV(key: string): Promise<void>;
  outboxAdd(record: OutboxRecord): Promise<number>;
  /** In id order. */
  outboxAll(): Promise<({ id: number } & OutboxRecord)[]>;
  /** All or nothing (one transaction). */
  outboxRemove(ids: number[]): Promise<void>;
  draftGet(id: string): Promise<string | undefined>;
  draftSet(id: string, text: string): Promise<void>;
  draftDelete(id: string): Promise<void>;
  /** False when data lives only in this page's memory, or the connection is currently lost. */
  readonly durable: boolean;
  /** Fires when `durable` changes. */
  onDurableChange(fn: () => void): () => void;
  close(): void;
}

interface NeoTextDB extends DBSchema {
  kv: { key: string; value: unknown };
  outbox: { key: number; value: OutboxRecord };
  drafts: { key: string; value: string };
}

const DB_VERSION = 1;
/** Before per-user databases; never released, so it is dropped, not migrated. */
const LEGACY_DB_NAME = 'neotext';
/** An open that neither succeeds nor fails (another tab blocking, broken profile) gives up here. */
const OPEN_TIMEOUT_MS = 5000;

export const dbNameFor = (userId: string) => `neotext:${userId}`;

/** Thrown by every call while the connection is lost (`durable` is false meanwhile). */
export class LostConnectionError extends Error {
  constructor() {
    super('The local database connection was closed; this change was not stored.');
    this.name = 'LostConnectionError';
  }
}

async function openRaw(name: string, onLost: () => void): Promise<IDBPDatabase<NeoTextDB>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const opening = openDB<NeoTextDB>(name, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('kv');
      db.createObjectStore('outbox', { autoIncrement: true });
      db.createObjectStore('drafts');
    },
    // A newer version opened in another tab: let it upgrade instead of blocking it forever.
    blocking(_current, _blocked, event) {
      (event.target as IDBDatabase).close();
      onLost();
    },
    terminated: onLost,
  });
  // Close a connection that arrives after we gave up on it.
  opening.then((late) => timedOut && late.close()).catch(() => {});
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error('IndexedDB open timed out'));
    }, OPEN_TIMEOUT_MS);
  });
  try {
    return await Promise.race([opening, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function idbPersistence(name: string, first: IDBPDatabase<NeoTextDB>, onLost: { fn: () => void }) {
  let db: IDBPDatabase<NeoTextDB> | null = first;
  let closed = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const fn of listeners) fn();
  };
  const conn = () => {
    if (!db) throw new LostConnectionError();
    return db;
  };
  onLost.fn = () => {
    if (!db) return;
    db = null;
    notify();
    if (closed) return;
    // Try to get the database back (works when the other tab's upgrade was abandoned).
    openRaw(name, () => onLost.fn())
      .then((again) => {
        if (closed) {
          again.close();
          return;
        }
        db = again;
        notify();
      })
      .catch(() => {
        // Stays non-durable: edits are kept in memory and still sent.
      });
  };
  const p: Persistence = {
    get durable() {
      return db !== null;
    },
    onDurableChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getKV: async <T>(key: string) => (await conn().get('kv', key)) as T | undefined,
    setKV: async (key, value) => {
      await conn().put('kv', value, key);
    },
    deleteKV: async (key) => {
      await conn().delete('kv', key);
    },
    outboxAdd: async (record) => conn().add('outbox', record),
    outboxAll: async () => {
      const tx = conn().transaction('outbox');
      const [ids, records] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll()]);
      await tx.done;
      return ids.map((id, i) => ({ id, ...(records[i] as OutboxRecord) }));
    },
    outboxRemove: async (ids) => {
      const tx = conn().transaction('outbox', 'readwrite');
      await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
    },
    draftGet: async (id) => conn().get('drafts', id),
    draftSet: async (id, text) => {
      await conn().put('drafts', text, id);
    },
    draftDelete: async (id) => conn().delete('drafts', id),
    close: () => {
      closed = true;
      db?.close();
      db = null;
    },
  };
  return p;
}

/** Same contract as the IndexedDB store, kept only for the life of the page. */
export function memoryPersistence(): Persistence {
  const kv = new Map<string, unknown>();
  const outbox = new Map<number, OutboxRecord>();
  const drafts = new Map<string, string>();
  let nextId = 1;
  return {
    durable: false,
    onDurableChange: () => () => {},
    getKV: async <T>(key: string) => structuredClone(kv.get(key)) as T | undefined,
    setKV: async (key, value) => {
      kv.set(key, structuredClone(value));
    },
    deleteKV: async (key) => {
      kv.delete(key);
    },
    outboxAdd: async (record) => {
      const id = nextId++;
      outbox.set(id, structuredClone(record));
      return id;
    },
    outboxAll: async () => [...outbox].map(([id, r]) => ({ id, ...structuredClone(r) })),
    outboxRemove: async (ids) => {
      for (const id of ids) outbox.delete(id);
    },
    draftGet: async (id) => drafts.get(id),
    draftSet: async (id, text) => {
      drafts.set(id, text);
    },
    draftDelete: async (id) => {
      drafts.delete(id);
    },
    close: () => {},
  };
}

/** Once per page (per factory, so tests with a fresh factory get it too). */
const legacyDiscarded = new WeakSet<IDBFactory>();
function discardLegacyDatabase(): void {
  if (legacyDiscarded.has(indexedDB)) return;
  legacyDiscarded.add(indexedDB);
  try {
    indexedDB.deleteDatabase(LEGACY_DB_NAME);
  } catch {
    // Nothing to clean up, or storage is blocked.
  }
}

/** Opens `neotext:<userId>`; any failure falls back to memory (`durable: false`). */
export async function openPersistence(userId: string): Promise<Persistence> {
  if (typeof indexedDB === 'undefined' || !indexedDB) return memoryPersistence();
  discardLegacyDatabase();
  const name = dbNameFor(userId);
  const onLost = { fn: () => {} };
  try {
    const db = await openRaw(name, () => onLost.fn());
    return idbPersistence(name, db, onLost);
  } catch {
    return memoryPersistence();
  }
}

let active: { userId: string; store: Promise<Persistence> } | null = null;
let pageMemory: Persistence | null = null;
/** Waiting for a user's store to open (see `whenUserPersistence`). */
const waiting = new Set<() => void>();

/** Makes `userId`'s store the page's store (closing another user's). */
export function openUserPersistence(userId: string): Promise<Persistence> {
  if (active?.userId === userId) return active.store;
  closeUserPersistence();
  active = { userId, store: openPersistence(userId) };
  for (const resolve of waiting) resolve();
  waiting.clear();
  return active.store;
}

/**
 * Resolves once a signed-in user's store is the page's store. After a reload the app's views
 * render before the session opens it, so what they read must wait for it.
 */
export function whenUserPersistence(): Promise<void> {
  if (active) return Promise.resolve();
  return new Promise((resolve) => waiting.add(resolve));
}

export function activeUserId(): string | null {
  return active?.userId ?? null;
}

/** The signed-in user's store; before sign-in, a page-memory store nobody else can see. */
export function activePersistence(): Promise<Persistence> {
  if (active) return active.store;
  pageMemory ??= memoryPersistence();
  return Promise.resolve(pageMemory);
}

export function closeUserPersistence(): void {
  const prev = active;
  active = null;
  pageMemory = null;
  void prev?.store.then((p) => p.close());
}
