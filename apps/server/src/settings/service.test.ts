import { randomBytes } from 'node:crypto';
import { defaultSettings } from '@neotext/shared';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createTestApp, setupOwner, type TestApp } from '../../test-support/test-app';
import { aad } from '../crypto/aad';
import { openJson, sealJson } from '../crypto/aead';
import { createSettingsRepo } from './repo';
import { createSettingsService } from './service';

const MIN = 60_000;
const PW = 'correct horse battery';
let t: TestApp;
let userId: string;
let dek: Buffer;

async function boot(app: TestApp): Promise<{ userId: string; dek: Buffer }> {
  const owner = await setupOwner(app);
  const token = decodeURIComponent(owner.cookie.split('=').slice(1).join('='));
  const s = app.c.sessions.resolve(token);
  if (!s) throw new Error('no session');
  return { userId: owner.user.id, dek: s.dek };
}

const rowOf = () =>
  t.c.db.raw.prepare('select * from user_settings where user_id = ?').get(userId) as {
    version: number;
    schema_version: number;
    data: Buffer;
  };
const historyRows = () =>
  t.c.db.raw
    .prepare(
      'select version, reason, data from user_settings_history where user_id = ? order by id',
    )
    .all(userId) as { version: number; reason: string; data: Buffer }[];
const setRaw = (value: unknown, schemaVersion = 1) =>
  t.c.db.raw
    .prepare('update user_settings set data = ?, schema_version = ? where user_id = ?')
    .run(sealJson(dek, value, aad('user_settings', 'data', userId)), schemaVersion, userId);
const rawJson = (): Record<string, unknown> =>
  openJson(dek, rowOf().data, aad('user_settings', 'data', userId));
const auditCount = (kind: string) =>
  t.c.db.raw.prepare('select count(*) n from audit_events where kind = ?').get(kind);

beforeEach(async () => {
  t = await createTestApp();
  ({ userId, dek } = await boot(t));
});
afterEach(() => t.close());

describe('settings service', () => {
  test('new user gets defaults at version 0', () => {
    const res = t.c.settings.get(userId, dek);
    expect(res).toEqual({
      version: 0,
      settings: defaultSettings(),
      resetPaths: [],
      recovered: false,
    });
    expect(t.c.db.raw.prepare('select count(*) n from user_settings').get()).toEqual({ n: 0 });
  });

  test('a patch is stored and survives a restart', async () => {
    t.c.settings.patch(userId, dek, { appearance: { theme: 'dark' } });
    await t.c.close();
    const t2 = await createTestApp({ dataDir: t.dataDir, clock: t.clock });
    try {
      const login = await t2.c.auth.login({ username: 'daryl', password: PW }, null);
      const s = t2.c.sessions.resolve(login.token);
      if (!s) throw new Error('no session');
      const res = t2.c.settings.get(userId, s.dek);
      expect(res.settings.appearance.theme).toBe('dark');
      expect(res.version).toBe(1);
    } finally {
      await t2.close();
    }
    t = await createTestApp(); // closed again by afterEach
  });

  test('patches to different fields from two tabs both stick', () => {
    t.c.settings.patch(userId, dek, { appearance: { theme: 'dark' } });
    const res = t.c.settings.patch(userId, dek, { chat: { sendKey: 'mod-enter' } });
    expect(res.version).toBe(2);
    expect(res.settings.appearance.theme).toBe('dark');
    expect(res.settings.chat.sendKey).toBe('mod-enter');
  });

  test('unknown keys survive patches', () => {
    t.c.settings.patch(userId, dek, { labs: { x: 1 } });
    const res = t.c.settings.patch(userId, dek, { appearance: { theme: 'light' } });
    expect((res.settings as Record<string, unknown>).labs).toEqual({ x: 1 });
    expect(rawJson().labs).toEqual({ x: 1 });
  });

  test('a stored value this version considers invalid survives a patch to another field', () => {
    t.c.settings.patch(userId, dek, { models: { favorites: ['a', 'b'] } });
    setRaw({ models: { favorites: ['a', 5, { odd: true }] } });
    const before = t.c.settings.get(userId, dek);
    // Only the invalid elements are dropped from the parsed view.
    expect(before.settings.models.favorites).toEqual(['a']);
    expect(before.resetPaths.length).toBeGreaterThan(0);
    const res = t.c.settings.patch(userId, dek, { appearance: { theme: 'dark' } });
    expect(res.settings.models.favorites).toEqual(['a']);
    expect((rawJson().models as { favorites: unknown }).favorites).toEqual(['a', 5, { odd: true }]);
    expect((rawJson().appearance as { theme: string }).theme).toBe('dark');
  });

  test('history is coalesced to one snapshot per 5 minutes', () => {
    const p = (theme: string) => t.c.settings.patch(userId, dek, { appearance: { theme } });
    p('dark'); // v1, no previous row, no snapshot
    expect(historyRows()).toHaveLength(0);
    t.clock.advance(MIN);
    p('light'); // snapshot of v1
    expect(historyRows()).toHaveLength(1);
    t.clock.advance(MIN);
    p('dark'); // skipped
    expect(historyRows()).toHaveLength(1);
    t.clock.advance(6 * MIN);
    p('light'); // 7 minutes after the last snapshot
    expect(historyRows().map((h) => h.version)).toEqual([1, 3]);
  });

  test('restore brings back an old version as a new version', () => {
    t.c.settings.patch(userId, dek, { appearance: { theme: 'dark' } });
    t.clock.advance(MIN);
    t.c.settings.patch(userId, dek, { appearance: { theme: 'light' } });
    const res = t.c.settings.restore(userId, dek, 1);
    expect(res.settings.appearance.theme).toBe('dark');
    expect(res.version).toBe(3);
    expect(t.c.settings.history(userId).some((h) => h.reason === 'restore')).toBe(true);
    expect(auditCount('settings.restored')).toEqual({ n: 1 });
  });

  test('restoring an unknown version is a 404', () => {
    t.c.settings.patch(userId, dek, { appearance: { theme: 'dark' } });
    expect(() => t.c.settings.restore(userId, dek, 99)).toThrowError(
      expect.objectContaining({ code: 'not_found', status: 404 }),
    );
  });

  test('corrupt data is quarantined, not overwritten', () => {
    t.c.settings.patch(userId, dek, { appearance: { theme: 'dark' } });
    const corruptBytes = randomBytes(64);
    t.c.db.raw.prepare('update user_settings set data = ?').run(corruptBytes);
    const res = t.c.settings.get(userId, dek);
    expect(res.recovered).toBe(true);
    expect(res.settings).toEqual(defaultSettings());
    expect(res.version).toBe(1);
    const q = t.c.db.raw
      .prepare("select data from user_settings_history where reason = 'quarantine'")
      .get() as { data: Buffer };
    expect(q.data.equals(corruptBytes)).toBe(true);
    t.c.settings.get(userId, dek); // does not quarantine twice
    expect(historyRows().filter((h) => h.reason === 'quarantine')).toHaveLength(1);
    expect(auditCount('settings.quarantined')).toEqual({ n: 1 });
  });

  test('a patch on a corrupt row quarantines it first and keeps version + 1', () => {
    t.c.settings.patch(userId, dek, { appearance: { theme: 'dark' } });
    t.c.settings.patch(userId, dek, { appearance: { theme: 'light' } });
    const corruptBytes = randomBytes(64);
    t.c.db.raw.prepare('update user_settings set data = ?').run(corruptBytes);
    const res = t.c.settings.patch(userId, dek, { chat: { sendKey: 'mod-enter' } });
    expect(res.version).toBe(3);
    expect(res.settings.chat.sendKey).toBe('mod-enter');
    expect(res.settings.appearance.theme).toBe(defaultSettings().appearance.theme);
    const q = historyRows().filter((h) => h.reason === 'quarantine');
    expect(q).toHaveLength(1);
    expect(q[0]?.data.equals(corruptBytes)).toBe(true);
    expect(q[0]?.version).toBe(2);
  });

  test('valid JSON that is not an object is treated as corrupt', () => {
    t.c.settings.patch(userId, dek, { appearance: { theme: 'dark' } });
    setRaw([1, 2, 3]);
    const stored = rowOf().data;
    const res = t.c.settings.get(userId, dek);
    expect(res.recovered).toBe(true);
    expect(
      historyRows()
        .find((h) => h.reason === 'quarantine')
        ?.data.equals(stored),
    ).toBe(true);
    const patched = t.c.settings.patch(userId, dek, { chat: { sendKey: 'mod-enter' } });
    expect(patched.version).toBe(2);
    expect(patched.settings.chat.sendKey).toBe('mod-enter');
  });

  test('newer schema_version is preserved', () => {
    t.c.settings.patch(userId, dek, { labs: { y: 2 } });
    t.c.db.raw.prepare('update user_settings set schema_version = 9').run();
    t.c.settings.patch(userId, dek, { appearance: { theme: 'dark' } });
    expect(rowOf().schema_version).toBe(9);
    expect(rawJson().labs).toEqual({ y: 2 });
  });

  test('an invalid stored schema_version is treated as version 1', () => {
    t.c.settings.patch(userId, dek, { appearance: { theme: 'dark' } });
    t.c.db.raw.prepare('update user_settings set schema_version = -4').run();
    expect(t.c.settings.get(userId, dek).settings.appearance.theme).toBe('dark');
    t.c.settings.patch(userId, dek, { chat: { sendKey: 'mod-enter' } });
    expect(rowOf().schema_version).toBe(1);
  });

  test('history keeps 50 snapshots', () => {
    for (let i = 0; i < 60; i++) {
      t.c.settings.patch(userId, dek, { appearance: { theme: i % 2 ? 'dark' : 'light' } });
      t.clock.advance(6 * MIN);
    }
    expect(t.c.settings.history(userId)).toHaveLength(50);
  });

  test('quarantined blobs are never pruned', () => {
    t.c.settings.patch(userId, dek, { appearance: { theme: 'dark' } });
    const corruptBytes = randomBytes(64);
    t.c.db.raw.prepare('update user_settings set data = ?').run(corruptBytes);
    t.c.settings.get(userId, dek);
    for (let i = 0; i < 60; i++) {
      t.clock.advance(6 * MIN);
      t.c.settings.patch(userId, dek, { appearance: { theme: i % 2 ? 'dark' : 'light' } });
    }
    const rows = historyRows();
    const q = rows.filter((h) => h.reason === 'quarantine');
    expect(q).toHaveLength(1);
    expect(q[0]?.data.equals(corruptBytes)).toBe(true);
    expect(rows.filter((h) => h.reason !== 'quarantine')).toHaveLength(50);
  });

  test('restoring a quarantined version is refused and changes nothing', () => {
    t.c.settings.patch(userId, dek, { appearance: { theme: 'dark' } });
    t.c.db.raw.prepare('update user_settings set data = ?').run(randomBytes(64));
    t.c.settings.get(userId, dek);
    const before = rowOf();
    expect(() => t.c.settings.restore(userId, dek, before.version)).toThrowError(
      expect.objectContaining({ code: 'conflict', status: 409 }),
    );
    const after = rowOf();
    expect(after.version).toBe(before.version);
    expect(after.data.equals(before.data)).toBe(true);
  });
});

describe('settings schema migration and unreadable rows', () => {
  const noopLog = { warn: () => {} } as never;
  const migratingService = () =>
    createSettingsService({
      repo: createSettingsRepo(t.c.db),
      clock: t.clock,
      audit: t.c.audit,
      log: noopLog,
      migrations: { 1: (raw) => ({ ...raw, migratedTo2: true }) },
      targetVersion: 2,
    });

  test('a migrating patch always snapshots the untouched previous blob, even when coalesced', () => {
    t.c.settings.patch(userId, dek, { appearance: { theme: 'dark' } });
    t.clock.advance(MIN);
    t.c.settings.patch(userId, dek, { appearance: { theme: 'light' } }); // autosave snapshot, now recent
    const before = rowOf();
    const rowsBefore = historyRows().length;
    t.clock.advance(1000); // well inside the coalescing window
    const res = migratingService().patch(userId, dek, { chat: { sendKey: 'mod-enter' } });
    const rows = historyRows();
    expect(rows).toHaveLength(rowsBefore + 1);
    const snap = rows[rows.length - 1];
    expect(snap?.reason).toBe('migration');
    expect(snap?.version).toBe(before.version);
    expect(snap?.data.equals(before.data)).toBe(true);
    expect(rowOf().schema_version).toBe(2);
    expect(rawJson().migratedTo2).toBe(true);
    expect(res.version).toBe(before.version + 1);
  });

  test('imported settings from an older schema are migrated, not reset', () => {
    t.c.settings.patch(userId, dek, { appearance: { theme: 'dark' } });
    const before = rowOf();
    const service = createSettingsService({
      repo: createSettingsRepo(t.c.db),
      clock: t.clock,
      audit: t.c.audit,
      log: noopLog,
      // Version 2 renamed `theme` to `mode`; a version 1 file still says `theme`.
      migrations: {
        1: (raw) => {
          const appearance = { ...(raw.appearance as Record<string, unknown>) };
          appearance.theme = appearance.mode ?? appearance.theme;
          return { ...raw, appearance, upgraded: true };
        },
      },
      targetVersion: 2,
    });
    const old = { locale: 'id', appearance: { mode: 'light' } };
    const res = service.replace(userId, dek, old, 1);
    expect(res.settings.locale).toBe('id');
    expect(res.settings.appearance.theme).toBe('light');
    expect(rawJson().upgraded).toBe(true);
    expect(rowOf().schema_version).toBe(2);
    const snap = historyRows().at(-1);
    expect(snap?.reason).toBe('restore');
    expect(snap?.data.equals(before.data)).toBe(true);
    // A file at the current version is not migrated again.
    service.replace(userId, dek, old, 2);
    expect(rawJson().upgraded).toBeUndefined();
  });

  test('restore of a snapshot quarantines an unreadable current row instead of snapshotting it as restore', () => {
    t.c.settings.patch(userId, dek, { appearance: { theme: 'dark' } });
    t.clock.advance(MIN);
    t.c.settings.patch(userId, dek, { appearance: { theme: 'light' } });
    const good = t.c.settings.history(userId)[0];
    if (!good) throw new Error('no snapshot');
    const corruptBytes = randomBytes(64);
    t.c.db.raw.prepare('update user_settings set data = ?').run(corruptBytes);
    const res = t.c.settings.restore(userId, dek, good.version);
    expect(res.settings.appearance.theme).toBe('dark');
    const rows = historyRows();
    const q = rows.filter((h) => h.reason === 'quarantine');
    expect(q).toHaveLength(1);
    expect(q[0]?.data.equals(corruptBytes)).toBe(true);
    expect(rows.filter((h) => h.reason === 'restore')).toHaveLength(0);
    expect(auditCount('settings.quarantined')).toEqual({ n: 1 });
  });
});
