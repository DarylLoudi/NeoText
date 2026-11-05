import 'fake-indexeddb/auto';
import { defaultSettings, type JsonObject, type SettingsResponse } from '@neotext/shared';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '../api/client';
import { openPersistence, type Persistence } from './db';
import { createOutbox, FLUSH_DELAY_MS, type Outbox } from './outbox';

/** Outbox behavior when the storage under it misbehaves. */

const resp: SettingsResponse = {
  version: 2,
  settings: defaultSettings(),
  resetPaths: [],
  recovered: false,
};
type Send = (patch: JsonObject, signal?: AbortSignal) => Promise<SettingsResponse>;

let store: Persistence;
let outbox: Outbox | undefined;
let timers: { fn: () => void; ms: number }[];
const schedule = (fn: () => void, ms: number) => {
  timers.push({ fn, ms });
};
const retryDelays = () => timers.map((t) => t.ms).filter((ms) => ms !== FLUSH_DELAY_MS);
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A store whose connection can be lost (`broken`: `durable` false, every call throws), whose next
 * reads can fail while still connected (`failReads`), and whose writes can be slowed down.
 */
function controllable() {
  const ctl = { broken: false, failReads: 0, slowAdd: 0 };
  const s: Persistence = {
    ...store,
    get durable() {
      return !ctl.broken;
    },
    outboxAll: async () => {
      if (ctl.broken) throw new Error('connection lost');
      if (ctl.failReads > 0) {
        ctl.failReads -= 1;
        throw new Error('read failed');
      }
      return store.outboxAll();
    },
    outboxRemove: async (ids) => {
      if (ctl.broken) throw new Error('connection lost');
      return store.outboxRemove(ids);
    },
    outboxAdd: async (rec) => {
      if (ctl.broken) throw new Error('connection lost');
      if (ctl.slowAdd) await tick(ctl.slowAdd);
      return store.outboxAdd(rec);
    },
  };
  return { s, ctl };
}

function make(s: Persistence, send: Send, own = true) {
  const created = createOutbox({
    store: s,
    send,
    onSynced: vi.fn(),
    onRejected: vi.fn(),
    schedule,
  });
  if (own) outbox = created;
  return created;
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  timers = [];
  store = await openPersistence('u1');
});
afterEach(() => {
  outbox?.stop();
  outbox = undefined;
  store.close();
});

describe('storage trouble', () => {
  test('a connection lost for good still delivers, older known stored edits first', async () => {
    const { s, ctl } = controllable();
    const send = vi
      .fn<Send>()
      .mockRejectedValueOnce(new ApiError('network', 'Offline.', 0))
      .mockResolvedValue(resp);
    const ob = make(s, send);
    await ob.enqueue({ locale: 'id', chat: { autoTitle: false } }); // stored, not yet sent
    await ob.flush(); // network failure: still pending
    ctl.broken = true; // another tab upgraded the database; reopening never succeeds
    await ob.enqueue({ locale: 'en' }); // memory only, newer
    expect(await ob.pending()).toEqual([
      { locale: 'id', chat: { autoTitle: false } },
      { locale: 'en' },
    ]);
    await ob.flush();
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      { locale: 'id', chat: { autoTitle: false } },
      // Both delivered in enqueue order: the newer memory-only 'en' wins over the older 'id'.
      { locale: 'en', chat: { autoTitle: false } },
    ]);
    expect(await ob.pending()).toEqual([]);
    await ob.flush();
    expect(send).toHaveBeenCalledTimes(2); // nothing resent
  });

  test('settled entries are not shown again when storage later breaks', async () => {
    const { s, ctl } = controllable();
    const breakAfterRemove: Persistence = {
      ...s,
      outboxRemove: async (ids) => {
        await s.outboxRemove(ids);
        ctl.broken = true; // the connection drops right after the delete
      },
    };
    const send = vi.fn<Send>(async () => resp);
    const ob = make(breakAfterRemove, send);
    await ob.enqueue({ locale: 'id' });
    await ob.flush();
    expect(await ob.pending()).toEqual([]);
    await ob.flush();
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('concurrent pending() calls neither duplicate nor lose memory-only edits', async () => {
    const { s, ctl } = controllable();
    const send = vi.fn<Send>(async () => resp);
    const ob = make(s, send);
    ctl.broken = true;
    await ob.enqueue({ locale: 'id' });
    await ob.enqueue({ chat: { autoTitle: false } });
    ctl.broken = false;
    ctl.slowAdd = 5;
    await Promise.all([ob.pending(), ob.pending(), ob.flush()]);
    await ob.flush();
    const sent = send.mock.calls.map((c) => c[0]);
    expect(sent).toEqual([{ locale: 'id', chat: { autoTitle: false } }]);
    expect(await store.outboxAll()).toEqual([]);
  });

  test('a memory-only edit moved to storage while in flight is not resent later', async () => {
    const { s, ctl } = controllable();
    let ob: Outbox | undefined;
    const send = vi.fn<Send>(async () => {
      ctl.broken = false; // storage comes back mid-request
      await ob?.pending(); // and the UI reads the outbox
      return resp;
    });
    ob = make(s, send);
    ctl.broken = true;
    await ob.enqueue({ locale: 'id' });
    await ob.flush();
    ctl.broken = false;
    await ob.flush();
    await ob.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(await store.outboxAll()).toEqual([]);
  });

  test.each([
    ['lost for good', { broken: true }],
    ['failing once', { failReads: 1 }],
  ])(
    "a read failure never sends another tab's delivered entries (connection %s)",
    async (_, how) => {
      const { s, ctl } = controllable();
      const sendA = vi.fn<Send>(async () => resp);
      const sendB = vi.fn<Send>(async () => resp);
      const tabA = make(s, sendA);
      const tabB = make(store, sendB, false);
      try {
        await tabB.enqueue({ locale: 'id' }); // X, stored by tab B
        expect(await tabA.pending()).toEqual([{ locale: 'id' }]); // tab A sees X
        await tabB.enqueue({ locale: 'fr' }); // Y, newer
        await tabB.flush(); // tab B delivers X and Y, deletes both
        expect(sendB.mock.calls.map((c) => c[0])).toEqual([{ locale: 'fr' }]);
        Object.assign(ctl, how);
        await tabA.flush();
        expect(sendA).not.toHaveBeenCalled(); // X would revert tab B's newer 'fr'
        if (ctl.broken) {
          await tabA.enqueue({ chat: { autoTitle: false } }); // tab A's own memory-only edit
          await tabA.flush();
          expect(sendA.mock.calls.map((c) => c[0])).toEqual([{ chat: { autoTitle: false } }]);
        }
      } finally {
        tabB.stop();
      }
    },
  );

  test('a one-off read failure retries with backoff and sends nothing until a read works', async () => {
    const { s, ctl } = controllable();
    const send = vi
      .fn<Send>()
      .mockRejectedValueOnce(new ApiError('network', 'Offline.', 0))
      .mockResolvedValue(resp);
    const ob = make(s, send);
    await ob.enqueue({ locale: 'id' }); // stored by this page
    await ob.flush(); // network failure: still stored
    expect(send).toHaveBeenCalledTimes(1);
    const runRetry = async () => {
      const i = timers.findIndex((t) => t.ms !== FLUSH_DELAY_MS);
      const [retry] = timers.splice(i, 1);
      retry?.fn();
      await ob.flush();
    };
    ctl.failReads = 1;
    await runRetry(); // the read fails while connected
    expect(send).toHaveBeenCalledTimes(1); // nothing sent from a fallback
    expect(retryDelays()).toEqual([1000]); // backed off again
    await runRetry(); // the read works
    expect(send.mock.calls.map((c) => c[0])).toEqual([{ locale: 'id' }, { locale: 'id' }]);
    expect(await store.outboxAll()).toEqual([]);
  });
});
