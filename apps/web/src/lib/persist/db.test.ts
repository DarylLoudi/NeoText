import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { openPersistence, type Persistence } from './db';

let opened: Persistence[] = [];
const open = async (userId: string) => {
  const p = await openPersistence(userId);
  opened.push(p);
  return p;
};
const names = async () => (await indexedDB.databases()).map((d) => d.name);

/** Opens `name` at `version` from "another tab"; optionally aborts the upgrade. */
function otherTabOpens(name: string, version: number, abortUpgrade: boolean): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => {
      if (abortUpgrade) req.transaction?.abort();
    };
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => resolve();
  });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  opened = [];
});
afterEach(() => {
  for (const p of opened) p.close();
  vi.unstubAllGlobals();
});

describe('persistence', () => {
  test('kv, outbox and drafts round trip', async () => {
    const store = await open('u1');
    await store.setKV('k', { a: 1 });
    expect(await store.getKV('k')).toEqual({ a: 1 });
    expect(await store.getKV('missing')).toBeUndefined();
    const a = await store.outboxAdd({ seq: 1, patch: { x: 1 } });
    const b = await store.outboxAdd({ seq: 2, patch: { y: 2 } });
    expect(b).toBeGreaterThan(a);
    await store.outboxRemove([a]);
    expect(await store.outboxAll()).toEqual([{ id: b, seq: 2, patch: { y: 2 } }]);
    await store.draftSet('c1', 'hello');
    expect(await store.draftGet('c1')).toBe('hello');
    await store.draftDelete('c1');
    expect(await store.draftGet('c1')).toBeUndefined();
  });

  test('each user has their own database', async () => {
    const a = await open('alice');
    await a.outboxAdd({ seq: 1, patch: { locale: 'id' } });
    await a.setKV('settings', { secret: true });
    await a.draftSet('new', 'from alice');
    const b = await open('bob');
    expect(await b.outboxAll()).toEqual([]);
    expect(await b.getKV('settings')).toBeUndefined();
    expect(await b.draftGet('new')).toBeUndefined();
    expect(await names()).toEqual(expect.arrayContaining(['neotext:alice', 'neotext:bob']));
  });

  test('the old unscoped database is discarded', async () => {
    await otherTabOpens('neotext', 1, false);
    expect(await names()).toContain('neotext');
    await open('u1');
    await vi.waitFor(async () => expect(await names()).not.toContain('neotext'));
  });

  test('falls back to memory when IndexedDB cannot be opened', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      deleteDatabase: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    const mem = await open('u1');
    expect(mem.durable).toBe(false);
    const id = await mem.outboxAdd({ seq: 1, patch: { x: 1 } });
    expect(await mem.outboxAll()).toEqual([{ id, seq: 1, patch: { x: 1 } }]);
    await mem.setKV('k', 1);
    expect(await mem.getKV('k')).toBe(1);
  });

  test('falls back to memory when IndexedDB is missing', async () => {
    vi.stubGlobal('indexedDB', undefined);
    expect((await open('u1')).durable).toBe(false);
  });
});

describe('a connection closed for another tab', () => {
  test('marks the store non-durable and stops quietly pretending', async () => {
    const store = await open('u1');
    const changed = vi.fn();
    store.onDurableChange(changed);
    await otherTabOpens('neotext:u1', 2, false);
    await vi.waitFor(() => expect(store.durable).toBe(false));
    expect(changed).toHaveBeenCalled();
    await expect(store.outboxAdd({ seq: 1, patch: { x: 1 } })).rejects.toThrow();
  });

  test('reopens when the other tab gives the database back', async () => {
    const store = await open('u1');
    await store.setKV('k', 'kept');
    const changed = vi.fn();
    store.onDurableChange(changed);
    await otherTabOpens('neotext:u1', 2, true);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
    expect(store.durable).toBe(true);
    expect(await store.getKV('k')).toBe('kept');
  });
});
