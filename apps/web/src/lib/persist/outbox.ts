import type { JsonObject, SettingsResponse } from '@neotext/shared';
import { ApiError } from '../api/client';
import { canComposePatches, composePatches } from './compose-patch';
import { LostConnectionError, type OutboxRecord, type Persistence } from './db';

export const RETRY_BACKOFF_MS = [500, 1000, 2000, 5000, 15000, 30000] as const;
/** Edits closer together than this go out as one request. */
export const FLUSH_DELAY_MS = 300;
/** A request that hangs longer is abandoned and retried, so it cannot hold the lock forever. */
export const SEND_TIMEOUT_MS = 15000;
/** Patches the server refused for good, kept so the user can try them again. */
export const REJECTED_KV_KEY = 'settings.rejected';
export const REJECTED_KEEP = 50;

export interface RejectedPatch {
  patch: JsonObject;
  code: string;
  message: string;
  at: number;
}

export interface Outbox {
  /** Stores the patch, then schedules a flush. Resolves once the patch is stored. */
  enqueue(patch: JsonObject): Promise<void>;
  flush(): Promise<void>;
  /** Patches not yet acknowledged by the server, in enqueue order. */
  pending(): Promise<JsonObject[]>;
  stop(): void;
}

export interface OutboxOptions {
  store: Persistence;
  send(patch: JsonObject, signal: AbortSignal): Promise<SettingsResponse>;
  onSynced(res: SettingsResponse): void;
  /** `patch` has been moved to `REJECTED_KV_KEY` (or, if that write failed, left stored). */
  onRejected(err: ApiError, patch: JsonObject): void;
  schedule?: (fn: () => void, ms: number) => unknown;
  /** Tabs of one user share an outbox; the lock keeps them from sending entries out of order. */
  lockName?: string;
  sendTimeoutMs?: number;
}

interface Entry extends OutboxRecord {
  id?: number;
}

type Outcome = 'retry' | 'pause' | 'drop';

/** Only these, from NeoText itself, say the patch can never be accepted. */
const DROP_CODES = new Set(['bad_request', 'validation_failed']);
/** Wrong route, wrong method or a proxy limit: the deployment is at fault, not the edit. */
const NEVER_DROP_STATUS = new Set([404, 405, 408, 413, 429]);

function classify(err: unknown): Outcome {
  if (!(err instanceof ApiError)) return 'retry';
  const { status, code } = err;
  if (status === 401 || status === 403) return 'pause';
  const drop = status >= 400 && status < 500 && !NEVER_DROP_STATUS.has(status);
  // A 4xx without a NeoText error body arrives as code 'internal', which is not a drop code.
  return drop && DROP_CODES.has(code) ? 'drop' : 'retry';
}

function withLock(name: string, fn: () => Promise<void>): Promise<void> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks?.request) return fn();
  return locks.request(name, fn);
}

function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const signal = AbortSignal.timeout(ms);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error('Request timed out'));
    signal.addEventListener('abort', onAbort, { once: true });
    run(signal)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}

let lastSeq = 0;
/** Strictly increasing within the page, roughly time-ordered across tabs. */
const nextSeq = () => {
  lastSeq = Math.max(Date.now(), lastSeq + 1);
  return lastSeq;
};

const entryKey = (e: Entry) => (e.id === undefined ? `v${e.seq}` : `s${e.id}`);

export function createOutbox(opts: OutboxOptions): Outbox {
  const { store, send, onSynced, onRejected } = opts;
  const schedule = opts.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const lockName = opts.lockName ?? 'neotext-settings-outbox';
  const sendTimeoutMs = opts.sendTimeoutMs ?? SEND_TIMEOUT_MS;
  /** Records whose storage write failed; they still go out, in their place, from this page. */
  const volatile: OutboxRecord[] = [];
  /** Acknowledged ids not yet deleted. Deleted together, oldest first, so none is skipped. */
  const settled = new Set<number>();
  /** Rejected ids that could not be moved to the rejected list: hidden here, kept stored. */
  const hidden = new Set<number>();
  /** Entries of a rejected batch, now sent one at a time to find the bad one. */
  const isolate = new Set<string>();
  let running: Promise<void> | null = null;
  let rerun = false;
  let paused = false;
  let stopped = false;
  let attempt = 0;
  let flushScheduled = false;
  let retryScheduled = false;

  /** seq -> stored id of memory-only records this page has since moved into storage. */
  const movedToStore = new Map<number, number>();
  /**
   * Stored entries this page enqueued or moved into storage, by id, until settled or seen gone.
   * Never another tab's: those may since have been delivered and overtaken by newer edits.
   */
  const own = new Map<number, Entry>();

  /**
   * Moves memory-only records into storage once it works again (keeping their seq). Called only
   * from `drain`, under the lock and never concurrently, so no record is stored twice or skipped.
   */
  async function storeVolatile(): Promise<void> {
    while (volatile.length > 0 && store.durable) {
      const [first] = volatile as [OutboxRecord];
      try {
        const id = await store.outboxAdd(first);
        movedToStore.set(first.seq, id);
        own.set(id, { id, ...first });
      } catch {
        return;
      }
      volatile.shift();
    }
  }

  async function removeSettled(): Promise<void> {
    if (settled.size === 0) return;
    const ids = [...settled].sort((a, b) => a - b);
    try {
      await store.outboxRemove(ids);
      for (const id of ids) {
        settled.delete(id);
        own.delete(id);
      }
    } catch {
      // Kept (all of them, in order) and retried on the next flush. Until then this page
      // hides them; another page replays them in order, ending in the same state.
    }
  }

  const visible = (e: Entry) => e.id === undefined || (!settled.has(e.id) && !hidden.has(e.id));
  const ordered = (entries: Entry[]) =>
    entries.sort((a, b) => a.seq - b.seq || (a.id ?? Infinity) - (b.id ?? Infinity));

  /** This page's own stored entries plus its memory-only ones, in enqueue order. */
  const known = () => ordered([...[...own.values()].filter(visible), ...volatile]);

  /**
   * Stored and memory-only entries in enqueue order, or null when a read failed while the
   * connection is up: the caller retries with backoff and sends nothing.
   *
   * Only while the connection is lost (`durable` false, or `LostConnectionError`) does a fallback
   * stand in: the entries THIS page enqueued or moved into storage, plus `volatile`, ordered and
   * later settled by seq, so this page's older edits still go out before its newer memory-only
   * ones. Never another tab's entries: that tab may have delivered them and newer ones since, and
   * resending them would revert its newer values. Accepted residual: this page may resend one of
   * its own stored entries that another tab already delivered.
   */
  async function readEntries(): Promise<Entry[] | null> {
    const before = [...own.keys()];
    let stored: Entry[];
    try {
      stored = await store.outboxAll();
    } catch (err) {
      if (store.durable && !(err instanceof LostConnectionError)) return null;
      return known();
    }
    // Own entries stored before this read and missing from it were delivered by another tab.
    const present = new Set(stored.map((e) => e.id));
    for (const id of before) if (!present.has(id)) own.delete(id);
    return ordered([...stored.filter(visible), ...volatile]);
  }

  async function settle(batch: Entry[]): Promise<void> {
    for (const e of batch) {
      isolate.delete(entryKey(e));
      // Match by seq too: a memory-only entry may have been stored since it was read.
      const i = volatile.findIndex((v) => v.seq === e.seq);
      if (i >= 0) volatile.splice(i, 1);
      const id = e.id ?? movedToStore.get(e.seq);
      movedToStore.delete(e.seq);
      if (id !== undefined) settled.add(id);
    }
    await removeSettled();
  }

  /** The longest run from the front that one merge patch can express. */
  function takeBatch(entries: Entry[]): { batch: Entry[]; patch: JsonObject } {
    const [first, ...rest] = entries as [Entry, ...Entry[]];
    const batch = [first];
    let patch = first.patch;
    if (isolate.has(entryKey(first))) return { batch, patch };
    for (const e of rest) {
      if (isolate.has(entryKey(e)) || !canComposePatches(patch, e.patch)) break;
      patch = composePatches(patch, e.patch);
      batch.push(e);
    }
    return { batch, patch };
  }

  async function reject(entry: Entry, err: ApiError): Promise<void> {
    let kept = false;
    try {
      const list = (await store.getKV<RejectedPatch[]>(REJECTED_KV_KEY)) ?? [];
      const item = { patch: entry.patch, code: err.code, message: err.message, at: Date.now() };
      await store.setKV(REJECTED_KV_KEY, [...list, item].slice(-REJECTED_KEEP));
      kept = true;
    } catch {
      // Could not keep a copy: leave it in the outbox (hidden here) rather than lose it.
    }
    const storedId = entry.id ?? movedToStore.get(entry.seq);
    if (kept || storedId === undefined) await settle([entry]);
    else {
      isolate.delete(entryKey(entry));
      hidden.add(storedId);
    }
    onRejected(err, entry.patch);
  }

  function scheduleRetry(): void {
    if (retryScheduled || stopped) return;
    retryScheduled = true;
    const ms = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)] ?? 30000;
    attempt += 1;
    schedule(() => {
      retryScheduled = false;
      void flush();
    }, ms);
  }

  async function drain(): Promise<void> {
    await removeSettled();
    while (!stopped) {
      await storeVolatile();
      const entries = await readEntries();
      if (entries === null) {
        scheduleRetry();
        return;
      }
      if (entries.length === 0) return;
      const { batch, patch } = takeBatch(entries);
      let res: SettingsResponse;
      try {
        res = await withTimeout(sendTimeoutMs, (signal) => send(patch, signal));
      } catch (err) {
        const outcome = classify(err);
        if (outcome === 'retry') {
          scheduleRetry();
          return;
        }
        if (outcome === 'pause') {
          paused = true;
          return;
        }
        const [only] = batch as [Entry];
        if (batch.length > 1) for (const e of batch) isolate.add(entryKey(e));
        else await reject(only, err as ApiError);
        continue;
      }
      attempt = 0;
      // Report first so the caller adopts the new server state before these leave `pending()`.
      onSynced(res);
      await settle(batch);
    }
  }

  function flush(): Promise<void> {
    if (stopped) return Promise.resolve();
    paused = false;
    if (running) {
      rerun = true;
      return running;
    }
    const run = async () => {
      try {
        do {
          rerun = false;
          await withLock(lockName, drain);
        } while (rerun && !stopped && !paused && !retryScheduled);
      } finally {
        running = null;
      }
    };
    running = run();
    return running;
  }

  function scheduleFlush(): void {
    if (flushScheduled || stopped) return;
    flushScheduled = true;
    schedule(() => {
      flushScheduled = false;
      void flush();
    }, FLUSH_DELAY_MS);
  }

  const onOnline = () => {
    attempt = 0;
    void flush();
  };
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline);

  return {
    async enqueue(patch) {
      const record: OutboxRecord = { seq: nextSeq(), patch: structuredClone(patch) };
      try {
        const id = await store.outboxAdd(record);
        own.set(id, { id, ...record }); // still sent if the connection is lost before it goes out
      } catch {
        volatile.push(record);
      }
      scheduleFlush();
    },
    flush,
    pending: async () => {
      // A failed read shows what this page knows of; nothing is sent from it.
      return ((await readEntries()) ?? known()).map((e) => e.patch);
    },
    stop() {
      stopped = true;
      if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
    },
  };
}
