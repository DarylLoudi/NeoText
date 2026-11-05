import 'fake-indexeddb/auto';
import {
  applyMergePatch,
  type JsonObject,
  parseSettings,
  type SettingsResponse,
} from '@neotext/shared';
import { act, renderHook } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { activePersistence, openUserPersistence } from '../lib/persist/db';
import { REJECTED_KV_KEY, type RejectedPatch } from '../lib/persist/outbox';
import { server } from '../test/msw';
import {
  flushSettings,
  getSettingsState,
  hydrateSettings,
  onServerSettings,
  onSettingsRejected,
  refetchSettings,
  restoreSettingsVersion,
  subscribeSettings,
  teardownSettings,
  updateSettings,
  useSettings,
} from './settings';

const state = getSettingsState;

const CODES: Record<number, string> = { 400: 'validation_failed', 401: 'unauthorized' };

/** A tiny stand-in for the server: stores the raw merged object, answers like the real routes. */
function fakeServer(initial: JsonObject = {}) {
  const s = {
    raw: structuredClone(initial),
    version: 1,
    patches: [] as JsonObject[],
    offline: false,
    patchStatus: 200,
    patchAttempts: 0,
    plainError: false,
    gate: null as Promise<void> | null,
    extra: {} as Partial<SettingsResponse>,
  };
  const body = (): SettingsResponse => ({
    version: s.version,
    ...parseSettings(s.raw),
    recovered: false,
    ...s.extra,
  });
  server.use(
    http.get('/api/settings', async () => {
      if (s.gate) await s.gate;
      return s.offline ? HttpResponse.error() : HttpResponse.json(body());
    }),
    http.patch('/api/settings', async ({ request }) => {
      s.patchAttempts += 1;
      if (s.offline) return HttpResponse.error();
      if (s.patchStatus !== 200) {
        if (s.plainError) return new HttpResponse('Bad gateway page', { status: s.patchStatus });
        const code = CODES[s.patchStatus] ?? 'internal';
        return HttpResponse.json({ error: { code, message: 'No.' } }, { status: s.patchStatus });
      }
      const { patch } = (await request.json()) as { patch: JsonObject };
      s.patches.push(patch);
      s.raw = applyMergePatch(s.raw, patch);
      s.version += 1;
      return HttpResponse.json(body());
    }),
    http.post('/api/settings/restore', async () => {
      s.raw = { appearance: { theme: 'light' } };
      s.version += 1;
      return HttpResponse.json(body());
    }),
  );
  return s;
}

/** Simulates a page reload (or sign-out): module state is gone, IndexedDB contents stay. */
const reload = () => teardownSettings();

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
afterEach(async () => {
  await reload();
  vi.unstubAllGlobals();
});

describe('settings store', () => {
  test('hydration: cache first, then server, then pending edits on top', async () => {
    const srv = fakeServer({ appearance: { theme: 'dark' } });
    const db = await openUserPersistence('u1');
    await db.setKV('settings', {
      version: 1,
      ...parseSettings({ appearance: { theme: 'light' } }),
      recovered: false,
    });
    await db.outboxAdd({ seq: 1, patch: { chat: { sendKey: 'mod-enter' } } });
    let release: () => void = () => {};
    srv.gate = new Promise((r) => {
      release = r;
    });

    const done = hydrateSettings('u1');
    await vi.waitFor(() => expect(state().hydrated).toBe(true));
    expect(state().settings.appearance.theme).toBe('light');
    expect(state().settings.chat.sendKey).toBe('mod-enter');

    release();
    await done;
    expect(state().settings.appearance.theme).toBe('dark');
    expect(state().settings.chat.sendKey).toBe('mod-enter');
    expect(srv.patches).toEqual([{ chat: { sendKey: 'mod-enter' } }]);
    expect(await db.outboxAll()).toEqual([]);
    const cached = await db.getKV<SettingsResponse>('settings');
    expect(cached?.settings.chat.sendKey).toBe('mod-enter');
    expect(state().version).toBe(2);
  });

  test('a change survives going offline and a reload', async () => {
    const srv = fakeServer({ appearance: { theme: 'light' } });
    await hydrateSettings('u1');
    srv.offline = true;
    updateSettings({ appearance: { theme: 'dark' } });
    expect(state().settings.appearance.theme).toBe('dark');
    await flushSettings();
    expect(srv.patches).toEqual([]);

    await reload();
    await hydrateSettings('u1'); // still offline: cached server state + pending edit
    expect(state().settings.appearance.theme).toBe('dark');

    await reload();
    srv.offline = false; // server back, still holding the old value
    await hydrateSettings('u1');
    expect(state().settings.appearance.theme).toBe('dark');
    expect(srv.patches).toEqual([{ appearance: { theme: 'dark' } }]);
    expect(srv.raw).toEqual({ appearance: { theme: 'dark' } });
  });

  test("another tab's change is picked up without losing pending edits", async () => {
    const srv = fakeServer();
    await hydrateSettings('u1');
    srv.offline = true;
    updateSettings({ chat: { autoTitle: false } });
    await flushSettings();
    srv.offline = false;
    srv.patchStatus = 503; // keep the local edit pending
    srv.raw = { appearance: { theme: 'dark' } }; // the other tab's saved change
    const db = await activePersistence();
    await db.outboxAdd({ seq: 1, patch: { appearance: { accent: 'rose' } } }); // the other tab's unsent change

    const other = new BroadcastChannel('neotext-settings:u1');
    const wrongUser = new BroadcastChannel('neotext-settings:u2');
    wrongUser.postMessage('changed');
    wrongUser.close();
    other.postMessage('changed');
    other.close();
    // The server state shows first; the shared outbox is re-read right after it.
    await vi.waitFor(() => {
      expect(state().settings.appearance.theme).toBe('dark');
      expect(state().settings.appearance.accent).toBe('rose');
    });
    expect(state().settings.chat.autoTitle).toBe(false);
  });

  test('refetchSettings shows a change the server made, keeping pending edits', async () => {
    const srv = fakeServer({ tools: { policies: { echo: 'ask' } } });
    await hydrateSettings('u1');
    expect(state().settings.tools.policies.echo).toBe('ask');
    // The server changes it itself (an approval with "Always allow").
    srv.raw = applyMergePatch(srv.raw, { tools: { policies: { echo: 'auto' } } }) as JsonObject;
    srv.version += 1;
    updateSettings({ chat: { sendKey: 'mod-enter' } });
    await refetchSettings();
    expect(state().settings.tools.policies.echo).toBe('auto');
    expect(state().settings.chat.sendKey).toBe('mod-enter');
  });

  test('a failed edit that goes through on a retry reports the new server state', async () => {
    const srv = fakeServer();
    await hydrateSettings('u1');
    const seen: [string | null, string | null | undefined][] = [];
    const off = onServerSettings((next, previous) =>
      seen.push([
        next.settings.webSearch.backendProviderId,
        previous?.settings.webSearch.backendProviderId,
      ]),
    );
    srv.patchStatus = 503;
    updateSettings({ webSearch: { backendProviderId: 'prv_s' } });
    await flushSettings();
    expect(seen).toEqual([]);
    srv.patchStatus = 200;
    await flushSettings();
    await vi.waitFor(() => expect(seen).toEqual([['prv_s', null]]));
    off();
  });

  test('50 rapid edits in another tab cause at most two reads here', async () => {
    const srv = fakeServer();
    let reads = 0;
    server.use(
      http.get('/api/settings', () => {
        reads += 1;
        return HttpResponse.json({
          version: srv.version,
          ...parseSettings(srv.raw),
          recovered: false,
        });
      }),
    );
    await hydrateSettings('u1'); // this tab
    // Another tab: its own copy of the store, sharing this browser's IndexedDB and channels.
    vi.resetModules();
    const tabA = await import('./settings');
    try {
      await tabA.hydrateSettings('u1');
      reads = 0;
      for (let i = 0; i < 50; i += 1) {
        tabA.updateSettings({ appearance: { fontScale: i % 2 === 0 ? 1.125 : 1.25 } });
      }
      await tabA.flushSettings();
      await vi.waitFor(() => expect(state().settings.appearance.fontScale).toBe(1.25), {
        timeout: 3000,
      });
      await new Promise((r) => setTimeout(r, 1000));
      expect(reads).toBeGreaterThanOrEqual(1);
      expect(reads).toBeLessThanOrEqual(2);
    } finally {
      await tabA.teardownSettings();
    }
  });

  test('falls back when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const srv = fakeServer();
    await hydrateSettings('u1');
    expect(state().durable).toBe(false);
    updateSettings({ appearance: { theme: 'dark' } });
    await flushSettings();
    expect(srv.patches).toEqual([{ appearance: { theme: 'dark' } }]);
    expect(state().settings.appearance.theme).toBe('dark');
  });

  test('recovered responses are exposed', async () => {
    const srv = fakeServer();
    srv.extra = { recovered: true, resetPaths: ['appearance.theme'] };
    await hydrateSettings('u1');
    expect(state().recovered).toBe(true);
    expect(state().resetPaths).toEqual(['appearance.theme']);
  });

  test('only the edited value is sent and unknown keys survive', async () => {
    const srv = fakeServer({ future: { x: 1 }, appearance: { theme: 'dark', knob: 2 } });
    await hydrateSettings('u1');
    updateSettings({ appearance: { accent: 'mint' } });
    await flushSettings();
    expect(srv.patches).toEqual([{ appearance: { accent: 'mint' } }]);
    expect(srv.raw).toEqual({
      future: { x: 1 },
      appearance: { theme: 'dark', knob: 2, accent: 'mint' },
    });
    const s = state().settings as JsonObject & { appearance: JsonObject };
    expect(s.future).toEqual({ x: 1 });
    expect(s.appearance.knob).toBe(2);
  });

  test('an array leaf with one bad element is not reset or sent back', async () => {
    const srv = fakeServer({ models: { favorites: ['p|a', 7, 'p|b'] } });
    await hydrateSettings('u1');
    expect(state().settings.models.favorites).toEqual(['p|a', 'p|b']);
    updateSettings({ chat: { autoTitle: false } });
    await flushSettings();
    expect(srv.patches).toEqual([{ chat: { autoTitle: false } }]);
  });

  test('a late response from an older request does not undo a newer one', async () => {
    const srv = fakeServer();
    await hydrateSettings('u1');
    let release: () => void = () => {};
    srv.gate = new Promise((r) => {
      release = r;
    });
    const staleGet = hydrateSettings('u1');
    await new Promise((r) => setTimeout(r, 20));
    srv.gate = null;
    updateSettings({ appearance: { theme: 'dark' } });
    await flushSettings();
    expect(srv.patches).toHaveLength(1);
    srv.raw = {}; // the stale GET will answer with the old value
    srv.version = 1;
    release();
    await staleGet;
    expect(state().settings.appearance.theme).toBe('dark');
  });

  test('a rejected edit is reported, dropped from the outbox and kept aside', async () => {
    const srv = fakeServer();
    await hydrateSettings('u1');
    const seen = vi.fn();
    const off = onSettingsRejected(seen);
    srv.patchStatus = 400;
    updateSettings({ appearance: { theme: 'dark' } });
    await flushSettings();
    off();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith(expect.anything(), { appearance: { theme: 'dark' } });
    expect(state().settings.appearance.theme).toBe('dark');
    const db = await activePersistence();
    expect(await db.outboxAll()).toEqual([]);
    const kept = await db.getKV<RejectedPatch[]>(REJECTED_KV_KEY);
    expect(kept?.map((r) => r.patch)).toEqual([{ appearance: { theme: 'dark' } }]);
  });

  test('a 4xx without a NeoText error body keeps the edit', async () => {
    const srv = fakeServer();
    await hydrateSettings('u1');
    srv.patchStatus = 400;
    srv.plainError = true;
    updateSettings({ appearance: { theme: 'dark' } });
    await flushSettings();
    expect(state().settings.appearance.theme).toBe('dark');
    expect(await (await activePersistence()).outboxAll()).toHaveLength(1);
  });

  test('restore sends pending edits first, then shows the restored version', async () => {
    const srv = fakeServer();
    await hydrateSettings('u1');
    updateSettings({ chat: { autoTitle: false } });
    await restoreSettingsVersion(1);
    expect(srv.patches).toEqual([{ chat: { autoTitle: false } }]);
    expect(state().settings.appearance.theme).toBe('light');
    expect(state().settings.chat.autoTitle).toBe(true);
  });

  test('appearance is applied to the document when touched', async () => {
    fakeServer();
    await hydrateSettings('u1');
    updateSettings({ appearance: { theme: 'dark' } });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    await flushSettings();
  });

  test('useSettings re-renders on change', async () => {
    fakeServer();
    await hydrateSettings('u1');
    const { result } = renderHook(() => useSettings((s) => s.settings.chat.sendKey));
    expect(result.current).toBe('enter');
    act(() => updateSettings({ chat: { sendKey: 'mod-enter' } }));
    expect(result.current).toBe('mod-enter');
    await flushSettings();
  });

  test('edits made before hydration are kept', async () => {
    const srv = fakeServer({ appearance: { theme: 'light' } });
    updateSettings({ appearance: { theme: 'dark' } });
    await hydrateSettings('u1');
    expect(state().settings.appearance.theme).toBe('dark');
    expect(srv.patches).toEqual([{ appearance: { theme: 'dark' } }]);
  });

  test("one user's pending edits, cache and look never reach another user", async () => {
    const srv = fakeServer({ appearance: { accent: 'rose' } });
    await hydrateSettings('alice');
    srv.patchStatus = 401; // alice's session lapsed: her edit is held
    updateSettings({ appearance: { theme: 'light' } });
    await flushSettings();
    expect(srv.patches).toEqual([]);
    await teardownSettings(); // sign-out
    expect(state().hydrated).toBe(false);
    expect(state().settings.appearance.theme).toBe('dark');

    const aliceRaw = srv.raw;
    srv.raw = {};
    srv.patchStatus = 200;
    const seenByBob: string[] = [];
    const look = () => `${state().settings.appearance.theme}/${state().settings.appearance.accent}`;
    const stop = subscribeSettings(() => seenByBob.push(look()));
    await hydrateSettings('bob');
    updateSettings({ chat: { autoTitle: false } });
    await flushSettings();
    stop();
    expect(seenByBob.length).toBeGreaterThan(0);
    expect(seenByBob.every((v) => v === 'dark/marker')).toBe(true);
    expect(srv.patches).toEqual([{ chat: { autoTitle: false } }]);
    await teardownSettings();

    srv.raw = aliceRaw;
    srv.patches = [];
    await hydrateSettings('alice');
    expect(srv.patches).toEqual([{ appearance: { theme: 'light' } }]);
    expect(state().settings.appearance.theme).toBe('light');
    expect(state().settings.appearance.accent).toBe('rose');
  });

  test('switching user without an explicit teardown still isolates', async () => {
    const srv = fakeServer();
    await hydrateSettings('alice');
    srv.patchStatus = 401;
    updateSettings({ locale: 'id' });
    await flushSettings();
    srv.patchStatus = 200;
    await hydrateSettings('bob');
    expect(state().settings.locale).toBe('auto');
    await flushSettings();
    expect(srv.patches).toEqual([]);
  });

  test('a store that loses its connection shows as not durable', async () => {
    fakeServer();
    await hydrateSettings('u1');
    expect(state().durable).toBe(true);
    await new Promise<void>((resolve) => {
      const req = indexedDB.open('neotext:u1', 2);
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
    });
    await vi.waitFor(() => expect(state().durable).toBe(false));
  });

  test('an edit made right before sign-out is kept for that user', async () => {
    const srv = fakeServer();
    await hydrateSettings('alice');
    updateSettings({ locale: 'id' });
    await teardownSettings(); // same tick as the edit
    expect(srv.patches).toEqual([]);
    await hydrateSettings('alice');
    expect(srv.patches).toEqual([{ locale: 'id' }]);
  });

  test('an edit made right before a user switch stays with the first user', async () => {
    const srv = fakeServer();
    await hydrateSettings('alice');
    updateSettings({ locale: 'id' });
    await hydrateSettings('bob');
    await flushSettings();
    expect(srv.patches).toEqual([]);
    expect(state().settings.locale).toBe('auto');
    await hydrateSettings('alice');
    expect(srv.patches).toEqual([{ locale: 'id' }]);
  });

  test('concurrent sign-ins build one runtime; the losing ones are stopped', async () => {
    const srv = fakeServer();
    await Promise.all([hydrateSettings('a'), hydrateSettings('b'), hydrateSettings('b')]);
    srv.patchStatus = 503;
    updateSettings({ locale: 'id' });
    await flushSettings();
    const before = srv.patchAttempts;
    window.dispatchEvent(new Event('online'));
    await new Promise((r) => setTimeout(r, 50));
    expect(srv.patchAttempts - before).toBe(1);
  });
});
