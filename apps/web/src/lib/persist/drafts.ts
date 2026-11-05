import { activePersistence, activeUserId, openPersistence, type Persistence } from './db';

export const DRAFT_SAVE_DELAY_MS = 300;

interface Unsaved {
  userId: string | null;
  key: string;
  text: string;
  timer: ReturnType<typeof setTimeout>;
}

/** Text typed but not yet written, by user and draft key (a conversation id or `new`). */
const unsaved = new Map<string, Unsaved>();
const writes = new Set<Promise<void>>();

const slot = (userId: string | null, key: string) => `${userId ?? ''}\u0000${key}`;

/** The store of the user who typed the text, even if someone else has signed in since. */
async function storeFor(userId: string | null): Promise<{ store: Persistence; temp: boolean }> {
  if (userId === activeUserId()) return { store: await activePersistence(), temp: false };
  if (userId === null) throw new Error('Signed-out draft after sign-in: nothing to keep.');
  return { store: await openPersistence(userId), temp: true };
}

function write(userId: string | null, key: string, text: string): void {
  const p = (async () => {
    try {
      const { store, temp } = await storeFor(userId);
      try {
        if (text === '') await store.draftDelete(key);
        else await store.draftSet(key, text);
      } finally {
        if (temp) store.close();
      }
    } catch {
      // Storage failed: the text is still in the composer, only reload safety is lost.
    }
  })();
  writes.add(p);
  void p.finally(() => writes.delete(p));
}

export async function loadDraft(key: string): Promise<string> {
  const pending = unsaved.get(slot(activeUserId(), key));
  if (pending) return pending.text;
  try {
    return (await (await activePersistence()).draftGet(key)) ?? '';
  } catch {
    return '';
  }
}

/** Debounced; empty text deletes the draft. */
export function saveDraft(key: string, text: string): void {
  const userId = activeUserId();
  const id = slot(userId, key);
  const prev = unsaved.get(id);
  if (prev) clearTimeout(prev.timer);
  const timer = setTimeout(() => {
    unsaved.delete(id);
    write(userId, key, text);
  }, DRAFT_SAVE_DELAY_MS);
  unsaved.set(id, { userId, key, text, timer });
}

export async function clearDraft(key: string): Promise<void> {
  const userId = activeUserId();
  const id = slot(userId, key);
  const prev = unsaved.get(id);
  if (prev) clearTimeout(prev.timer);
  unsaved.delete(id);
  write(userId, key, '');
  await flushDrafts();
}

/** Writes every pending draft now and waits for all writes. */
export async function flushDrafts(): Promise<void> {
  for (const { userId, key, text, timer } of unsaved.values()) {
    clearTimeout(timer);
    write(userId, key, text);
  }
  unsaved.clear();
  await Promise.all([...writes]);
}

if (typeof window !== 'undefined') {
  // The tab is going away (close, reload, bfcache): do not wait out the debounce.
  window.addEventListener('pagehide', () => void flushDrafts());
  // Mobile browsers may kill a hidden tab without a pagehide.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushDrafts();
  });
}
