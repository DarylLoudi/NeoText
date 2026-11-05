import {
  applyMergePatch,
  defaultSettings,
  isJsonObject,
  type JsonObject,
  parseSettings,
  type SettingsResponse,
  type UserSettings,
} from '@neotext/shared';
import { useSyncExternalStore } from 'react';
import { applyAppearance } from '../design/theme';
import type { ApiError } from '../lib/api/client';
import { settingsApi } from '../lib/api/settings';
import { closeUserPersistence, openUserPersistence, type Persistence } from '../lib/persist/db';
import { flushDrafts } from '../lib/persist/drafts';
import { createOutbox, type Outbox } from '../lib/persist/outbox';
import { openSettingsSignals } from './settings-signals';

export interface SettingsState {
  settings: UserSettings;
  version: number;
  /** True once a server state (cached or fresh) has been shown. */
  hydrated: boolean;
  recovered: boolean;
  resetPaths: string[];
  /** False when edits live only in this page's memory (IndexedDB unavailable or lost). */
  durable: boolean;
}

const CACHE_KEY = 'settings';

/** Everything bound to one signed-in user. Names are per user so tabs of others stay apart. */
interface Runtime {
  userId: string;
  store: Persistence;
  outbox: Outbox;
  signal: () => void;
  /** Set by stop(); a stopped runtime takes no more edits. */
  stopped: boolean;
  stop: () => void;
}

const initialState = (): SettingsState => ({
  settings: defaultSettings(),
  version: 0,
  hydrated: false,
  recovered: false,
  resetPaths: [],
  durable: true,
});

let state = initialState();
const listeners = new Set<() => void>();
const rejectionListeners = new Set<(err: ApiError, patch: JsonObject) => void>();
const serverListeners = new Set<
  (next: SettingsResponse, previous: SettingsResponse | null) => void
>();

/** The last server state adopted. Local edits are always layered on top of it, never merged in. */
let server: SettingsResponse | null = null;
/** Outbox contents as last read (may include entries the server just acknowledged: harmless). */
let storedPending: JsonObject[] = [];
/** Edits made in this page whose outbox write has not finished yet. */
let unstored: JsonObject[] = [];
/** Serializes outbox writes with outbox reads so an edit is never missing from both lists. */
let chain: Promise<void> = Promise.resolve();
let current: Runtime | null = null;
/** Edits made before any user is known wait here for the first runtime. */
let ready = deferred<Runtime>();
/** Each server request takes a stamp when sent; answers older than the last adopted one lose. */
let stampSeq = 0;
let adoptedStamp = 0;
let lastPatchStamp = 0;

function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** The look last written to the document; kept across sign-out (theme-boot shows it next). */
let appliedAppearance = '';

function setState(next: Partial<SettingsState>, opts: { applyLook?: boolean } = {}): void {
  state = { ...state, ...next };
  const look = JSON.stringify(state.settings.appearance);
  if ((opts.applyLook ?? true) && look !== appliedAppearance) {
    appliedAppearance = look;
    applyAppearance(state.settings.appearance);
  }
  for (const fn of listeners) fn();
}

/** settings = server state, then every pending edit applied in order, then lenient parsing. */
function compute(extra: Partial<SettingsState> = {}): void {
  let merged: unknown = server?.settings ?? defaultSettings();
  for (const patch of [...storedPending, ...unstored]) merged = applyMergePatch(merged, patch);
  setState({
    settings: parseSettings(merged).settings,
    version: server?.version ?? 0,
    recovered: server?.recovered ?? false,
    resetPaths: server?.resetPaths ?? [],
    ...extra,
  });
}

function queue(task: () => Promise<void>): Promise<void> {
  chain = chain.then(task).catch(() => {
    // A failed step must not block later ones; each step handles its own errors.
  });
  return chain;
}

/** Waits until every queued step, including ones queued while waiting, has run. */
async function settleChain(): Promise<void> {
  let seen: Promise<void>;
  do {
    seen = chain;
    await seen;
  } while (seen !== chain);
}

function refresh(rt: Runtime): Promise<void> {
  return queue(async () => {
    const pending = await rt.outbox.pending();
    if (rt !== current) return;
    storedPending = pending;
    compute();
  });
}

function adopt(rt: Runtime, res: SettingsResponse, stamp: number): void {
  if (rt !== current) return; // an answer for a user who has signed out
  // A newer server version always wins (a PATCH answer can arrive after a later-sent GET); a
  // lower one only when it was asked for later (the server's database was restored).
  const newerVersion = server !== null && res.version > server.version;
  if (stamp < adoptedStamp && !newerVersion) return;
  adoptedStamp = Math.max(adoptedStamp, stamp);
  const previous = server;
  server = res;
  compute({ hydrated: true });
  for (const fn of serverListeners) fn(res, previous);
  void queue(async () => {
    try {
      await rt.store.setKV(CACHE_KEY, res);
    } catch {
      // Cache is a speed-up only.
    }
  });
  void refresh(rt);
}

async function refetch(rt: Runtime): Promise<void> {
  const stamp = ++stampSeq;
  try {
    adopt(rt, await settingsApi.get(), stamp);
  } catch {
    // Offline or signed out: keep what is shown; the next hydrate or edit catches up.
  }
}

async function buildRuntime(userId: string): Promise<Runtime> {
  const store = await openUserPersistence(userId);
  const holder: { rt?: Runtime } = {};
  const outbox = createOutbox({
    store,
    lockName: `neotext-settings-outbox:${userId}`,
    send: async (patch, abort) => {
      const stamp = ++stampSeq;
      const res = await settingsApi.patch(patch, abort);
      lastPatchStamp = stamp;
      return res;
    },
    onSynced: (res) => {
      if (!holder.rt) return;
      adopt(holder.rt, res, lastPatchStamp);
      holder.rt.signal();
    },
    onRejected: (err, patch) => {
      if (holder.rt !== current || !holder.rt) return;
      for (const fn of rejectionListeners) fn(err, patch);
      void refresh(holder.rt);
    },
  });
  const signals = openSettingsSignals(userId, () => {
    if (holder.rt) void refetch(holder.rt);
  });
  const offDurable = store.onDurableChange(() => {
    if (holder.rt === current) setState({ durable: store.durable });
  });
  const rt: Runtime = {
    userId,
    store,
    outbox,
    signal: signals.send,
    stopped: false,
    stop: () => {
      rt.stopped = true;
      outbox.stop();
      signals.close();
      offDurable();
    },
  };
  holder.rt = rt;
  return rt;
}

/** Runtime starts and teardowns run one at a time, so two sign-ins never build two runtimes. */
let runtimeOps: Promise<unknown> = Promise.resolve();
function serially<T>(op: () => Promise<T>): Promise<T> {
  const p = runtimeOps.then(op);
  runtimeOps = p.catch(() => {});
  return p;
}

/** The runtime for `userId`; a different user's runtime is torn down first. */
function startRuntime(userId: string): Promise<Runtime> {
  return serially(async () => {
    if (current?.userId === userId) return current;
    if (current) await teardownNow();
    const rt = await buildRuntime(userId);
    current = rt;
    adoptedStamp = stampSeq + 1; // nothing asked for before this user counts
    setState({ durable: rt.store.durable });
    ready.resolve(rt);
    return rt;
  });
}

export function getSettingsState(): SettingsState {
  return state;
}

export function subscribeSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** `selector` must return a stable value (a field or slice), not a new object per call. */
export function useSettings<T>(selector: (s: SettingsState) => T): T {
  return useSyncExternalStore(
    subscribeSettings,
    () => selector(state),
    () => selector(state),
  );
}

/**
 * Called when the server refuses an edit for good (a NeoText validation error). The patch is
 * kept under `settings.rejected` in the user's store so it can be offered again.
 */
export function onSettingsRejected(fn: (err: ApiError, patch: JsonObject) => void): () => void {
  rejectionListeners.add(fn);
  return () => rejectionListeners.delete(fn);
}

/** Called with each new server state: a saved edit (retries too), or another tab's change. */
export function onServerSettings(
  fn: (next: SettingsResponse, previous: SettingsResponse | null) => void,
): () => void {
  serverListeners.add(fn);
  return () => serverListeners.delete(fn);
}

/**
 * Shows the edit at once, stores it in the signed-in user's outbox, then lets the outbox send
 * it. `patch` is a merge patch of what the user changed, never a whole settings object.
 */
export function updateSettings(patch: JsonObject): void {
  if (!isJsonObject(patch)) return;
  const copy = structuredClone(patch);
  unstored.push(copy);
  compute();
  const target = current ? Promise.resolve(current) : ready.promise;
  void queue(async () => {
    const rt = await target;
    // Checked against this edit's own runtime, not the current one: an edit made just before a
    // sign-out or user switch still lands in the outbox of the user who made it.
    if (rt.stopped) return;
    await rt.outbox.enqueue(copy);
    unstored = unstored.filter((p) => p !== copy);
    storedPending.push(copy);
    rt.signal();
  });
}

/**
 * Binds the store to `userId` (tearing down another user's), shows the cached state first, then
 * the server state with pending edits re-applied on top, then flushes. Rejects only when there
 * is neither a cache nor a server answer.
 */
export async function hydrateSettings(userId: string): Promise<void> {
  const rt = await startRuntime(userId);
  if (!server) {
    let cached: unknown;
    try {
      cached = await rt.store.getKV(CACHE_KEY);
    } catch {
      cached = undefined;
    }
    if (isJsonObject(cached) && typeof cached.version === 'number') {
      const parsed = parseSettings(cached.settings);
      adopt(
        rt,
        {
          version: cached.version,
          settings: parsed.settings,
          resetPaths: Array.isArray(cached.resetPaths) ? (cached.resetPaths as string[]) : [],
          recovered: cached.recovered === true,
        },
        ++stampSeq,
      );
    }
  }
  await refresh(rt);
  const stamp = ++stampSeq;
  let res: SettingsResponse;
  try {
    res = await settingsApi.get();
  } catch (err) {
    await rt.outbox.flush(); // Pending edits get their own try (and a retry schedule).
    if (!server) throw err;
    return;
  }
  adopt(rt, res, stamp);
  await settleChain();
  await rt.outbox.flush();
  await settleChain();
}

/** Sends every stored edit now and waits for the outcome. */
export async function flushSettings(): Promise<void> {
  await settleChain();
  const rt = current;
  if (!rt) return;
  await rt.outbox.flush();
  await settleChain();
}

/**
 * Reads the settings again after the server changed them by itself (an approval with "Always
 * allow"), and tells this user's other tabs to do the same. Pending edits stay on top.
 */
export async function refetchSettings(): Promise<void> {
  const rt = current;
  if (!rt) return;
  await refetch(rt);
  rt.signal();
}

/**
 * Pending edits go out first so the server snapshots them into history before restoring;
 * nothing the user changed is lost, it stays one restore away.
 */
export async function restoreSettingsVersion(version: number): Promise<void> {
  await settleChain();
  const rt = current;
  if (!rt) throw new Error('Settings are not loaded yet.');
  await rt.outbox.flush();
  const stamp = ++stampSeq;
  const res = await settingsApi.restore(version);
  adopt(rt, res, stamp);
  await settleChain();
  rt.signal();
}

/**
 * For sign-out or a user switch. Unsent edits stay in that user's database and go out when
 * they sign in again; nothing of theirs remains in memory for the next user.
 */
export function teardownSettings(): Promise<void> {
  return serially(teardownNow);
}

async function teardownNow(): Promise<void> {
  const rt = current;
  // Edits queued before this call (even in the same tick) finish into this user's outbox first;
  // `current` stays set meanwhile so they are not mistaken for a signed-out user's.
  if (rt) await settleChain();
  current = null;
  await flushDrafts();
  rt?.stop();
  closeUserPersistence();
  server = null;
  storedPending = [];
  unstored = [];
  chain = Promise.resolve();
  ready = deferred<Runtime>();
  adoptedStamp = stampSeq + 1;
  // The document keeps the last look until the next user's settings arrive.
  setState(initialState(), { applyLook: false });
}

/** Synchronous variant for test cleanup; prefer `teardownSettings`. */
export function resetSettingsStoreForTests(): void {
  void teardownSettings();
}
