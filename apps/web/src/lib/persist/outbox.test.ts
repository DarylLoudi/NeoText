import 'fake-indexeddb/auto';
import {
  defaultSettings,
  isJsonObject,
  type JsonObject,
  type SettingsResponse,
} from '@neotext/shared';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '../api/client';
import { openPersistence, type Persistence } from './db';
import {
  createOutbox,
  FLUSH_DELAY_MS,
  type Outbox,
  type OutboxOptions,
  REJECTED_KEEP,
  REJECTED_KV_KEY,
  RETRY_BACKOFF_MS,
  type RejectedPatch,
} from './outbox';

const resp: SettingsResponse = {
  version: 2,
  settings: defaultSettings(),
  resetPaths: [],
  recovered: false,
};
const networkError = () => new ApiError('network', 'Could not reach the server.', 0);
type Send = (patch: JsonObject, signal?: AbortSignal) => Promise<SettingsResponse>;
const invalid = () => new ApiError('validation_failed', 'Bad patch.', 400);

let store: Persistence;
let outbox: Outbox | undefined;
let timers: { fn: () => void; ms: number }[];
const schedule = (fn: () => void, ms: number) => {
  timers.push({ fn, ms });
};
const retryDelays = () => timers.map((t) => t.ms).filter((ms) => ms !== FLUSH_DELAY_MS);
const fireRetry = () => {
  const i = timers.findIndex((t) => t.ms !== FLUSH_DELAY_MS);
  const [t] = timers.splice(i, 1);
  t?.fn();
};

function make(send: Send, extra: Partial<OutboxOptions> = {}) {
  const onSynced = vi.fn();
  const onRejected = vi.fn();
  const created = createOutbox({ store, send, onSynced, onRejected, schedule, ...extra });
  outbox = created;
  return { outbox: created, onSynced, onRejected };
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

describe('outbox', () => {
  test('writes to storage before the network', async () => {
    let storedDuringRequest: unknown[] = [];
    const send = vi.fn(async () => {
      storedDuringRequest = await store.outboxAll();
      return resp;
    });
    const { outbox, onSynced } = make(send);
    await outbox.enqueue({ appearance: { theme: 'dark' } });
    expect(send).not.toHaveBeenCalled();
    await outbox.flush();
    expect(storedDuringRequest).toHaveLength(1);
    expect(await store.outboxAll()).toEqual([]);
    expect(onSynced).toHaveBeenCalledWith(resp);
  });

  test('enqueue schedules one short delayed flush', async () => {
    const send = vi.fn<Send>(async () => resp);
    const { outbox } = make(send);
    await outbox.enqueue({ locale: 'id' });
    await outbox.enqueue({ locale: 'en' });
    expect(timers.map((t) => t.ms)).toEqual([FLUSH_DELAY_MS]);
    timers[0]?.fn();
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ locale: 'en' }, expect.anything()));
    await vi.waitFor(async () => expect(await store.outboxAll()).toEqual([]));
  });

  test('failures keep the patch and retry with backoff', async () => {
    const send = vi
      .fn<Send>()
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(new ApiError('internal', 'Server error.', 503))
      .mockResolvedValue(resp);
    const { outbox, onRejected } = make(send);
    await outbox.enqueue({ appearance: { theme: 'dark' } });
    await outbox.flush();
    expect(retryDelays()).toEqual([500]);
    expect(await store.outboxAll()).toHaveLength(1);
    fireRetry();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(retryDelays()).toEqual([1000]));
    expect(await store.outboxAll()).toHaveLength(1);
    fireRetry();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    await vi.waitFor(async () => expect(await store.outboxAll()).toEqual([]));
    expect(onRejected).not.toHaveBeenCalled();
    expect(RETRY_BACKOFF_MS).toEqual([500, 1000, 2000, 5000, 15000, 30000]);
  });

  test('backoff caps at the last delay', async () => {
    const send = vi.fn<Send>(async () => {
      throw networkError();
    });
    const { outbox } = make(send);
    await outbox.enqueue({ locale: 'id' });
    await outbox.flush();
    const seen = [...retryDelays()];
    for (let i = 1; i < 8; i++) {
      fireRetry();
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(i + 1));
      await vi.waitFor(() => expect(retryDelays()).toHaveLength(1));
      seen.push(...retryDelays());
    }
    expect(seen).toEqual([500, 1000, 2000, 5000, 15000, 30000, 30000, 30000]);
    expect(await store.outboxAll()).toHaveLength(1);
  });

  test('401 pauses without losing data', async () => {
    const send = vi
      .fn<Send>()
      .mockRejectedValueOnce(new ApiError('unauthorized', 'Sign in again.', 401))
      .mockResolvedValue(resp);
    const { outbox, onRejected } = make(send);
    await outbox.enqueue({ chat: { sendKey: 'mod-enter' } });
    await outbox.flush();
    expect(retryDelays()).toEqual([]);
    expect(await store.outboxAll()).toHaveLength(1);
    expect(onRejected).not.toHaveBeenCalled();
    await outbox.flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(await store.outboxAll()).toEqual([]);
  });

  test('403 also pauses instead of dropping', async () => {
    const send = vi.fn<Send>(async () => {
      throw new ApiError('forbidden', 'Request origin not allowed.', 403);
    });
    const { outbox, onRejected } = make(send);
    await outbox.enqueue({ locale: 'id' });
    await outbox.flush();
    expect(onRejected).not.toHaveBeenCalled();
    expect(retryDelays()).toEqual([]);
    expect(await store.outboxAll()).toHaveLength(1);
  });

  test('429 retries with backoff', async () => {
    const send = vi
      .fn<Send>()
      .mockRejectedValueOnce(new ApiError('rate_limited', 'Slow down.', 429))
      .mockResolvedValue(resp);
    const { outbox } = make(send);
    await outbox.enqueue({ locale: 'id' });
    await outbox.flush();
    expect(retryDelays()).toEqual([500]);
    expect(await store.outboxAll()).toHaveLength(1);
  });

  test('a validation 4xx drops the patch, keeps a copy and reports it', async () => {
    const err = invalid();
    const send = vi.fn<Send>(async () => {
      throw err;
    });
    const { outbox, onRejected } = make(send);
    await outbox.enqueue({ locale: 'id' });
    await outbox.flush();
    expect(onRejected).toHaveBeenCalledTimes(1);
    expect(onRejected).toHaveBeenCalledWith(err, { locale: 'id' });
    expect(await store.outboxAll()).toEqual([]);
    const kept = await store.getKV<RejectedPatch[]>(REJECTED_KV_KEY);
    expect(kept).toEqual([
      {
        patch: { locale: 'id' },
        code: 'validation_failed',
        message: 'Bad patch.',
        at: expect.any(Number),
      },
    ]);
    expect(retryDelays()).toEqual([]);
  });

  test('rapid edits are one request', async () => {
    const send = vi.fn<Send>(async () => resp);
    const { outbox } = make(send);
    await outbox.enqueue({ appearance: { theme: 'dark' } });
    await outbox.enqueue({ appearance: { accent: 'mint' } });
    await outbox.enqueue({ chat: { autoTitle: false } });
    expect(await outbox.pending()).toHaveLength(3);
    await outbox.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      {
        appearance: { theme: 'dark', accent: 'mint' },
        chat: { autoTitle: false },
      },
      expect.anything(),
    );
  });

  test('a reset followed by an edit inside it goes out as two ordered requests', async () => {
    const send = vi.fn<Send>(async () => resp);
    const { outbox } = make(send);
    await outbox.enqueue({ appearance: null });
    await outbox.enqueue({ appearance: { theme: 'dark' } });
    await outbox.flush();
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      { appearance: null },
      { appearance: { theme: 'dark' } },
    ]);
  });

  test('edits made while a request is in flight are sent next', async () => {
    let release: () => void = () => {};
    const send = vi
      .fn<Send>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(resp);
          }),
      )
      .mockResolvedValue(resp);
    const { outbox } = make(send);
    await outbox.enqueue({ locale: 'id' });
    const first = outbox.flush();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await outbox.enqueue({ locale: 'en' });
    const second = outbox.flush();
    release();
    await Promise.all([first, second]);
    expect(send.mock.calls.map((c) => c[0])).toEqual([{ locale: 'id' }, { locale: 'en' }]);
    expect(await store.outboxAll()).toEqual([]);
  });

  test('a failed storage write still sends the change', async () => {
    const broken: Persistence = {
      ...store,
      outboxAdd: async () => {
        throw new Error('QuotaExceededError');
      },
    };
    const send = vi.fn<Send>(async () => resp);
    outbox = createOutbox({
      store: broken,
      send,
      onSynced: vi.fn(),
      onRejected: vi.fn(),
      schedule,
    });
    await outbox.enqueue({ locale: 'id' });
    expect(await outbox.pending()).toEqual([{ locale: 'id' }]);
    await outbox.flush();
    expect(send).toHaveBeenCalledWith({ locale: 'id' }, expect.anything());
    expect(await outbox.pending()).toEqual([]);
  });

  test('the online event triggers a flush', async () => {
    const send = vi.fn<Send>().mockRejectedValueOnce(networkError()).mockResolvedValue(resp);
    const { outbox } = make(send);
    await outbox.enqueue({ locale: 'id' });
    await outbox.flush();
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => expect(await store.outboxAll()).toEqual([]));
  });

  test('entries survive reopening the database', async () => {
    const { outbox } = make(vi.fn(async () => resp));
    await outbox.enqueue({ locale: 'id' });
    outbox.stop();
    store.close();
    store = await openPersistence('u1');
    expect(store.durable).toBe(true);
    expect((await store.outboxAll()).map((e) => e.patch)).toEqual([{ locale: 'id' }]);
  });
});

describe('rejections lose nothing', () => {
  test('a rejected batch is resent one entry at a time; only the bad entry is dropped', async () => {
    const send = vi.fn<Send>(async (patch) => {
      if (isJsonObject(patch.chat) && 'bad' in patch.chat) throw invalid();
      return resp;
    });
    const { outbox, onRejected } = make(send);
    await outbox.enqueue({ locale: 'id' });
    await outbox.enqueue({ chat: { bad: 1 } });
    await outbox.enqueue({ appearance: { theme: 'dark' } });
    await outbox.flush();
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      { locale: 'id', chat: { bad: 1 }, appearance: { theme: 'dark' } },
      { locale: 'id' },
      { chat: { bad: 1 } },
      { appearance: { theme: 'dark' } },
    ]);
    expect(onRejected).toHaveBeenCalledTimes(1);
    expect(onRejected).toHaveBeenCalledWith(expect.any(ApiError), { chat: { bad: 1 } });
    expect(await store.outboxAll()).toEqual([]);
    const kept = await store.getKV<RejectedPatch[]>(REJECTED_KV_KEY);
    expect(kept?.map((r) => r.patch)).toEqual([{ chat: { bad: 1 } }]);
  });

  test.each([
    [
      'a 4xx without a NeoText error body',
      new ApiError('internal', 'The server returned an error (400).', 400),
    ],
    ['404', new ApiError('not_found', 'Not found.', 404)],
    ['405', new ApiError('bad_request', 'Method not allowed.', 405)],
    ['413', new ApiError('payload_too_large', 'Too large.', 413)],
    ['409', new ApiError('conflict', 'Conflict.', 409)],
  ])('%s keeps the patch and retries with backoff', async (_name, err) => {
    const send = vi.fn<Send>(async () => {
      throw err;
    });
    const { outbox, onRejected } = make(send);
    await outbox.enqueue({ locale: 'id' });
    await outbox.flush();
    expect(onRejected).not.toHaveBeenCalled();
    expect(retryDelays()).toEqual([500]);
    expect(await store.outboxAll()).toHaveLength(1);
  });

  test('the kept list of rejected patches is capped, newest last', async () => {
    const old: RejectedPatch[] = Array.from({ length: REJECTED_KEEP }, (_, i) => ({
      patch: { n: i },
      code: 'validation_failed',
      message: 'x',
      at: i,
    }));
    await store.setKV(REJECTED_KV_KEY, old);
    const { outbox } = make(
      vi.fn<Send>(async () => {
        throw invalid();
      }),
    );
    await outbox.enqueue({ locale: 'id' });
    await outbox.flush();
    const kept = (await store.getKV<RejectedPatch[]>(REJECTED_KV_KEY)) ?? [];
    expect(REJECTED_KEEP).toBe(50);
    expect(kept).toHaveLength(REJECTED_KEEP);
    expect(kept[0]?.patch).toEqual({ n: 1 });
    expect(kept.at(-1)?.patch).toEqual({ locale: 'id' });
  });
});

describe('ordering', () => {
  test('a failed delete is retried with later ones, never skipped over', async () => {
    const removeCalls: number[][] = [];
    let failNext = true;
    const flaky: Persistence = {
      ...store,
      outboxRemove: async (ids) => {
        removeCalls.push(ids);
        if (failNext) {
          failNext = false;
          throw new Error('transaction aborted');
        }
        await store.outboxRemove(ids);
      },
    };
    const send = vi.fn<Send>(async () => resp);
    outbox = createOutbox({ store: flaky, send, onSynced: vi.fn(), onRejected: vi.fn(), schedule });
    await outbox.enqueue({ appearance: { theme: 'dark' } });
    await outbox.flush();
    const [first] = await store.outboxAll();
    expect(first?.patch).toEqual({ appearance: { theme: 'dark' } }); // still stored
    await outbox.enqueue({ appearance: { theme: 'light' } });
    await outbox.flush();
    expect(send).toHaveBeenCalledTimes(2); // the settled entry is not resent by this page
    // The first call failed; entry 1 must be deleted (by a later, successful call) no later
    // than the first call that deletes entry 2.
    const id1 = first?.id ?? -1;
    const j = removeCalls.findIndex((ids) => ids.some((id) => id !== id1));
    expect(j).toBeGreaterThan(0);
    expect(removeCalls.slice(1, j + 1).some((ids) => ids.includes(id1))).toBe(true);
    expect(await store.outboxAll()).toEqual([]);
  });

  test('a patch whose storage write failed keeps its place among stored ones', async () => {
    let calls = 0;
    const flaky: Persistence = {
      ...store,
      outboxAdd: async (rec) => {
        calls += 1;
        if (calls === 2) throw new Error('QuotaExceededError');
        return store.outboxAdd(rec);
      },
    };
    const send = vi.fn<Send>(async () => resp);
    outbox = createOutbox({ store: flaky, send, onSynced: vi.fn(), onRejected: vi.fn(), schedule });
    await outbox.enqueue({ locale: 'id' });
    await outbox.enqueue({ locale: 'en' });
    await outbox.enqueue({ locale: 'auto' });
    expect(await outbox.pending()).toEqual([
      { locale: 'id' },
      { locale: 'en' },
      { locale: 'auto' },
    ]);
    await outbox.flush();
    expect(send).toHaveBeenCalledWith({ locale: 'auto' }, expect.anything());
  });
});

describe('send timeout', () => {
  test('a hung request is aborted and retried, so the lock is released', async () => {
    let seen: AbortSignal | undefined;
    const send = vi
      .fn<Send>()
      .mockImplementationOnce((_p, signal) => {
        seen = signal;
        return new Promise(() => {});
      })
      .mockResolvedValue(resp);
    const { outbox } = make(send, { sendTimeoutMs: 20 });
    await outbox.enqueue({ locale: 'id' });
    await outbox.flush();
    expect(seen?.aborted).toBe(true);
    expect(retryDelays()).toEqual([500]);
    expect(await store.outboxAll()).toHaveLength(1);
    fireRetry();
    await vi.waitFor(async () => expect(await store.outboxAll()).toEqual([]));
  });
});
