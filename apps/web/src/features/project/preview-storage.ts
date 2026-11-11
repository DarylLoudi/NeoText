import { activePersistence } from '../../lib/persist/db';

/**
 * What a chat's preview page keeps in its `localStorage`, stored in this browser under the
 * chat's id. It never goes to the server.
 */
const SAVE_DELAY_MS = 300;
const keyFor = (conversationId: string) => `preview-storage:${conversationId}`;

type Items = Record<string, string>;

const pending = new Map<string, { items: Items; timer: ReturnType<typeof setTimeout> }>();
const writes = new Set<Promise<void>>();

function write(conversationId: string, items: Items): void {
  const p = (async () => {
    try {
      await (await activePersistence()).setKV(keyFor(conversationId), items);
    } catch {
      // Storage failed: the page keeps working, only the next visit starts without its data.
    }
  })();
  writes.add(p);
  void p.finally(() => writes.delete(p));
}

const isItems = (value: unknown): value is Items =>
  typeof value === 'object' &&
  value !== null &&
  Object.values(value).every((v) => typeof v === 'string');

export async function loadPreviewStorage(conversationId: string): Promise<Items> {
  const unsaved = pending.get(conversationId);
  if (unsaved) return unsaved.items;
  try {
    const stored = await (await activePersistence()).getKV<unknown>(keyFor(conversationId));
    return isItems(stored) ? stored : {};
  } catch {
    return {};
  }
}

/** Debounced: a page that writes on every keystroke costs one store write. */
export function savePreviewStorage(conversationId: string, items: Items): void {
  const before = pending.get(conversationId);
  if (before) clearTimeout(before.timer);
  const timer = setTimeout(() => {
    pending.delete(conversationId);
    write(conversationId, items);
  }, SAVE_DELAY_MS);
  pending.set(conversationId, { items, timer });
}

export async function clearPreviewStorage(conversationId: string): Promise<void> {
  const before = pending.get(conversationId);
  if (before) clearTimeout(before.timer);
  pending.delete(conversationId);
  write(conversationId, {});
  await flushPreviewStorage();
}

/** Removes what chats deleted for good kept, with any save of theirs still waiting. */
export async function forgetPreviewStorage(conversationIds: string[]): Promise<void> {
  if (conversationIds.length === 0) return;
  for (const id of conversationIds) {
    const before = pending.get(id);
    if (before) clearTimeout(before.timer);
    pending.delete(id);
  }
  await Promise.all([...writes]);
  try {
    const db = await activePersistence();
    for (const id of conversationIds) await db.deleteKV(keyFor(id));
  } catch {
    // Left behind: at most the 1 MB the page could keep, and nothing reads it again.
  }
}

/** Writes what is waiting now and settles when every write has. */
export async function flushPreviewStorage(): Promise<void> {
  for (const [conversationId, { items, timer }] of pending) {
    clearTimeout(timer);
    pending.delete(conversationId);
    write(conversationId, items);
  }
  await Promise.all([...writes]);
}

/** The storage the panel uses, handed to it so its lazy chunk does not import the database. */
export interface PreviewStorage {
  load(conversationId: string): Promise<Items>;
  save(conversationId: string, items: Items): void;
  clear(conversationId: string): Promise<void>;
}

export const previewStorage: PreviewStorage = {
  load: loadPreviewStorage,
  save: savePreviewStorage,
  clear: clearPreviewStorage,
};
