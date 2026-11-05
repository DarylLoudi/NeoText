import { newId, SETTINGS_SCHEMA_VERSION } from '@neotext/shared';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  addUser,
  authContextFor,
  authed,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';
import type { AuthContext } from '../http/env';
import { type BundleV1, openBundle } from './bundle';

const PW = 'kata sandi yang panjang';
const KEY = 'sk-or-test-export-0123456789';

let t: TestApp;
let auth: AuthContext;
let api: ReturnType<typeof authed>;

beforeEach(async () => {
  t = await createTestApp();
  const { cookie } = await setupOwner(t);
  auth = authContextFor(t, cookie);
  api = authed(t, cookie);
});
afterEach(() => t.close());

/** A conversation with one user/assistant turn; returns its id. */
function seed(a: AuthContext, title: string | null, text = 'Halo'): string {
  const id = newId('cnv');
  const at = t.c.clock.now();
  t.c.repos.conversations.insert(
    { id, userId: a.userId, folderId: null, title, createdAt: at },
    a.dek,
  );
  const u = newId('msg');
  const m = newId('msg');
  const base = { conversationId: id, userId: a.userId, status: 'complete' as const, createdAt: at };
  t.c.repos.messages.insert(
    {
      ...base,
      id: u,
      parentId: null,
      role: 'user',
      parts: [{ type: 'text', text }],
      providerId: null,
      modelId: null,
    },
    a.dek,
  );
  t.c.repos.messages.insert(
    {
      ...base,
      id: m,
      parentId: u,
      role: 'assistant',
      parts: [{ type: 'text', text: `Jawaban untuk ${text}` }],
      providerId: 'prv_x',
      modelId: 'test/model',
      createdAt: at + 1,
    },
    a.dek,
  );
  t.c.repos.conversations.update(a.userId, id, { activeLeafId: m, messageCount: 2 }, at, a.dek);
  return id;
}

const post = (body: unknown) => api('/api/export', { method: 'POST', body: JSON.stringify(body) });

describe('export', () => {
  test('a single chat is one Markdown file', async () => {
    const id = seed(auth, 'Rencana: skripsi', 'Apa kabar?');
    const res = await post({ format: 'markdown', conversationId: id });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="Rencana skripsi.md"; filename*=UTF-8''Rencana%20skripsi.md`,
    );
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(text).toContain('# Rencana: skripsi\n');
    expect(text).toContain('## You\n\nApa kabar?\n');
    expect(text).toContain('## test/model\n\nJawaban untuk Apa kabar?\n');
  });

  test('non-ASCII file names use RFC 5987', async () => {
    const id = seed(auth, 'Café 日本');
    const res = await post({ format: 'markdown', conversationId: id });
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="Caf_ __.md"; filename*=UTF-8''Caf%C3%A9%20%E6%97%A5%E6%9C%AC.md`,
    );
  });

  test('zip contains one file per conversation with safe names', async () => {
    seed(auth, 'a/b: c');
    seed(auth, 'a/b: c');
    seed(auth, null);
    seed(auth, '..hidden');
    const trashed = seed(auth, 'Gone');
    t.c.repos.conversations.softDelete(auth.userId, trashed, t.c.clock.now());
    const res = await post({ format: 'markdown' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain(
      'filename="neotext-chats-20261103.zip"',
    );
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(
      ['Untitled chat.md', 'ab c (2).md', 'ab c.md', 'hidden.md'].sort(),
    );
    expect(strFromU8(files['hidden.md'] as Uint8Array)).toMatch(/^# \.\.hidden\n/);
  });

  test('a chat that is missing or not yours is a 404', async () => {
    const other = await addUser(t, 'tamu');
    const theirs = seed(other.auth, 'Milik orang lain');
    expect((await post({ format: 'markdown', conversationId: theirs })).status).toBe(404);
    expect((await post({ format: 'markdown', conversationId: 'cnv_nope' })).status).toBe(404);
  });

  test('neotext bundle holds everything and opens with the passphrase', async () => {
    const id = seed(auth, 'Rahasia');
    t.c.presets.create(auth, {
      name: 'Penulis',
      position: 'a0',
      data: {
        systemPrompt: 'Tulis singkat.',
        model: null,
        reasoningEffort: null,
        temperature: null,
        maxOutputTokens: null,
        webSearch: false,
        color: null,
      },
    });
    const res = await post({ format: 'neotext', passphrase: PW });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-disposition')).toContain(
      'filename="neotext-export-20261103.ntxb"',
    );
    const file = Buffer.from(await res.arrayBuffer());
    expect(file.toString('utf8')).not.toContain('Rahasia');
    const bundle = await openBundle(file, PW);
    expect(bundle.version).toBe(1);
    expect(bundle.exportedAt).toBe(t.c.clock.now());
    expect(bundle.app).toContain('NeoText');
    expect(bundle.conversations.map((c) => c.title)).toEqual(['Rahasia']);
    expect(bundle.messages.filter((m) => m.conversationId === id)).toHaveLength(2);
    expect(bundle.presets.map((p) => p.name)).toEqual(['Penulis']);
    expect(bundle.settings).toEqual(t.c.settings.get(auth.userId, auth.dek).settings);
    // The importer migrates settings from this version; it must match what `settings` holds.
    expect(bundle.settingsSchemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
  });

  test('provider keys only when asked', async () => {
    const log = vi.spyOn(t.c.log, 'info');
    await t.c.providers.create(auth, { kind: 'openrouter', name: 'OR', apiKey: KEY });
    const plain = await openBundle(
      Buffer.from(await (await post({ format: 'neotext', passphrase: PW })).arrayBuffer()),
      PW,
    );
    expect(plain.providers).toBeUndefined();

    const res = await post({ format: 'neotext', passphrase: PW, includeProviderKeys: true });
    const file = Buffer.from(await res.arrayBuffer());
    expect(file.toString('latin1')).not.toContain(KEY);
    const withKeys = await openBundle(file, PW);
    expect(withKeys.providers).toEqual([
      {
        kind: 'openrouter',
        name: 'OR',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: KEY,
        headers: null,
        manualModels: [],
        category: 'llm',
      },
    ]);

    // Plain formats can never carry keys.
    expect(
      (await post({ format: 'json', confirmPlaintext: true, includeProviderKeys: true })).status,
    ).toBe(400);
    const json = await (await post({ format: 'json', confirmPlaintext: true })).text();
    expect(json).not.toContain(KEY);
    expect((JSON.parse(json) as BundleV1).providers).toBeUndefined();
    expect(JSON.stringify(log.mock.calls)).not.toContain(KEY);
    const audit = t.c.db.raw.prepare('SELECT meta FROM audit_events').all() as { meta: string }[];
    expect(JSON.stringify(audit)).not.toContain(KEY);
  });

  test('shared providers are not part of a personal export', async () => {
    const before = t.c.providers.list(auth).length;
    await t.c.providers.create(auth, { kind: 'openrouter', name: 'Mine', apiKey: KEY });
    t.c.db.raw.prepare("UPDATE providers SET owner_user_id = NULL WHERE name = 'Mine'").run();
    expect(t.c.providers.list(auth)).toHaveLength(before + 1);
    const res = await post({ format: 'neotext', passphrase: PW, includeProviderKeys: true });
    const bundle = await openBundle(Buffer.from(await res.arrayBuffer()), PW);
    expect(bundle.providers?.map((p) => p.name) ?? []).not.toContain('Mine');
  });

  test('json needs explicit confirmation', async () => {
    seed(auth, 'Terbuka');
    expect((await post({ format: 'json' })).status).toBe(400);
    expect((await post({ format: 'json', confirmPlaintext: false })).status).toBe(400);
    expect((await post({ format: 'neotext' })).status).toBe(400);
    expect((await post({ format: 'neotext', passphrase: 'pendek' })).status).toBe(400);
    expect((await post({ format: 'markdown', includeProviderKeys: true })).status).toBe(400);
    const res = await post({ format: 'json', confirmPlaintext: true });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('content-disposition')).toContain(
      'filename="neotext-export-20261103.json"',
    );
    const bundle = (await res.json()) as BundleV1;
    expect(bundle.version).toBe(1);
    expect(bundle.conversations.map((c) => c.title)).toEqual(['Terbuka']);
  });

  test('export is per user and audited', async () => {
    const other = await addUser(t, 'tamu');
    seed(auth, 'Punyaku');
    seed(other.auth, 'Punya tamu');
    const res = await post({ format: 'json', confirmPlaintext: true });
    const bundle = (await res.json()) as BundleV1;
    expect(bundle.conversations.map((c) => c.title)).toEqual(['Punyaku']);
    expect(
      bundle.messages.every((m) => bundle.conversations.some((c) => c.id === m.conversationId)),
    ).toBe(true);

    await post({ format: 'markdown' });
    const rows = t.c.db.raw
      .prepare("SELECT user_id, meta FROM audit_events WHERE kind = 'data.exported' ORDER BY rowid")
      .all() as { user_id: string; meta: string }[];
    expect(rows.map((r) => [r.user_id, JSON.parse(r.meta)])).toEqual([
      [auth.userId, { format: 'json' }],
      [auth.userId, { format: 'markdown' }],
    ]);
  });

  test('export needs a session', async () => {
    const res = await t.app.request('/api/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3420' },
      body: JSON.stringify({ format: 'markdown' }),
    });
    expect(res.status).toBe(401);
  });

  test('a provider whose key cannot be opened is exported without it', async () => {
    await t.c.providers.create(auth, { kind: 'openrouter', name: 'Broken', apiKey: KEY });
    await t.c.providers.create(auth, { kind: 'openrouter', name: 'Fine', apiKey: `${KEY}-2` });
    t.c.db.raw
      .prepare("UPDATE providers SET api_key = ? WHERE name = 'Broken'")
      .run(Buffer.alloc(40, 1));
    const res = await post({ format: 'neotext', passphrase: PW, includeProviderKeys: true });
    expect(res.status).toBe(200);
    const bundle = await openBundle(Buffer.from(await res.arrayBuffer()), PW);
    const byName = Object.fromEntries((bundle.providers ?? []).map((p) => [p.name, p]));
    expect(byName.Broken).toMatchObject({ kind: 'openrouter', apiKey: null, headers: null });
    expect(byName.Fine?.apiKey).toBe(`${KEY}-2`);
  });

  test('every export but a single chat is rate limited', async () => {
    const id = seed(auth, 'Satu');
    for (let i = 0; i < 5; i++) {
      expect(
        (await post({ format: i % 2 ? 'markdown' : 'json', confirmPlaintext: !(i % 2) })).status,
      ).toBe(200);
    }
    expect((await post({ format: 'json', confirmPlaintext: true })).status).toBe(429);
    expect((await post({ format: 'markdown' })).status).toBe(429);
    expect((await post({ format: 'neotext', passphrase: PW })).status).toBe(429);
    expect((await post({ format: 'markdown', conversationId: id })).status).toBe(200);
  });
});
