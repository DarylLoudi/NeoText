import { type MessagePublic, newId, siblingsOf } from '@neotext/shared';
import { describe, expect, test } from 'vitest';
import { addUser } from '../../test-support/test-app';
import {
  all,
  auth,
  bundleFile,
  detail,
  importer,
  KEY,
  message,
  PW,
  seed,
  summary,
  t,
  useImportApp,
} from './import-test-support';

useImportApp();

describe('import a NeoText bundle', () => {
  test('wrong passphrase imports nothing', async () => {
    seed(auth, 'Satu');
    const file = (await t.c.exporter.exportData(auth, { format: 'neotext', passphrase: PW })).data;
    const before = all(auth).length;
    await expect(
      importer().importData(auth, { source: 'neotext', file, passphrase: 'wrong wrong wrong' }),
    ).rejects.toMatchObject({ code: 'bad_request' });
    await expect(importer().importData(auth, { source: 'neotext', file })).rejects.toMatchObject({
      code: 'bad_request',
      details: { reason: 'passphrase_required' },
    });
    await expect(
      importer().importData(auth, { source: 'neotext', file, passphrase: 'wrong wrong wrong' }),
    ).rejects.toMatchObject({ details: { reason: 'wrong_passphrase' } });
    expect(all(auth)).toHaveLength(before);
  });

  test('bundle round trip into another account', async () => {
    const folder = {
      id: newId('fld'),
      parentId: null,
      name: 'Kuliah',
      color: '#112233',
      position: 'a0',
    };
    t.c.repos.folders.insert(
      { ...folder, userId: auth.userId, createdAt: 1, updatedAt: 1 },
      auth.dek,
    );
    const child = {
      id: newId('fld'),
      parentId: folder.id,
      name: 'Skripsi',
      color: null,
      position: 'a1',
    };
    t.c.repos.folders.insert(
      { ...child, userId: auth.userId, createdAt: 2, updatedAt: 2 },
      auth.dek,
    );
    const preset = t.c.presets.create(auth, {
      name: 'Penulis',
      position: 'a0',
      data: {
        systemPrompt: 'Tulis dengan rapi.',
        model: null,
        reasoningEffort: null,
        temperature: 0.5,
        maxOutputTokens: null,
        webSearch: false,
        color: null,
      },
    });
    const id = seed(auth, 'Bab satu', { folderId: child.id });
    t.c.repos.conversations.update(
      auth.userId,
      id,
      { presetId: preset.id, pinned: true, pinPosition: '0001' },
      t.c.clock.now(),
      auth.dek,
    );
    await t.c.providers.create(auth, {
      kind: 'openai-compatible',
      name: 'Lokal',
      baseUrl: 'http://127.0.0.1:9/v1',
      apiKey: KEY,
    });
    const original = detail(auth, id);
    const file = (
      await t.c.exporter.exportData(auth, {
        format: 'neotext',
        passphrase: PW,
        includeProviderKeys: true,
      })
    ).data;

    // Admin: the bundle's provider has a private address, which only an admin may add.
    const other = await addUser(t, 'tamu', 'admin');
    const result = await importer().importData(other.auth, {
      source: 'neotext',
      file,
      passphrase: PW,
    });
    expect(result).toEqual({ imported: 1, skipped: 0, failed: [] });

    const [c] = all(other.auth);
    if (!c) throw new Error('nothing imported');
    expect(c.id).not.toBe(id);
    expect(c.title).toBe('Bab satu');
    expect(c.pinned).toBe(true);
    const folders = t.c.repos.folders.list(other.auth.userId, other.auth.dek);
    expect(folders.map((f) => f.name).sort()).toEqual(['Kuliah', 'Skripsi']);
    const theirChild = folders.find((f) => f.name === 'Skripsi');
    const theirParent = folders.find((f) => f.name === 'Kuliah');
    expect(theirChild?.id).not.toBe(child.id);
    expect(theirChild?.parentId).toBe(theirParent?.id);
    expect(theirParent?.color).toBe('#112233');
    expect(c.folderId).toBe(theirChild?.id);
    const presets = t.c.presets.list(other.auth);
    expect(presets.map((p) => p.name)).toEqual(['Penulis']);
    expect(presets[0]?.id).not.toBe(preset.id);
    expect(c.presetId).toBe(presets[0]?.id);

    const d = detail(other.auth, c.id);
    const strip = (ms: MessagePublic[]) =>
      ms.map((m) => ({
        role: m.role,
        status: m.status,
        parts: m.parts,
        usage: m.usage,
        finishReason: m.finishReason,
        createdAt: m.createdAt,
      }));
    expect(strip(d.messages)).toEqual(strip(original.messages));
    expect(d.messages.every((m) => !original.messages.some((o) => o.id === m.id))).toBe(true);
    // The tree and the active leaf survive with the new ids.
    const leaf = d.messages.find((m) => m.id === c.activeLeafId);
    expect(leaf?.status).toBe('complete');
    expect(siblingsOf(d.messages, leaf?.id ?? '').siblings).toHaveLength(2);

    // Provider keys become the importer's own providers.
    const providers = t.c.providers.list(other.auth).filter((p) => !p.shared);
    expect(providers.map((p) => p.name)).toEqual(['Lokal']);
    const theirProvider = providers[0];
    if (!theirProvider) throw new Error('provider missing');
    expect(t.c.providers.resolve(other.auth, theirProvider.id).apiKey).toBe(KEY);

    // A's data is untouched.
    expect(all(auth).map((x) => x.id)).toEqual([id]);
    expect(detail(auth, id).messages).toEqual(original.messages);
  });

  test('importing a bundle twice does not duplicate chats, folders, presets or providers', async () => {
    const folderId = newId('fld');
    t.c.repos.folders.insert(
      {
        id: folderId,
        parentId: null,
        name: 'Kuliah',
        color: null,
        position: 'a0',
        userId: auth.userId,
        createdAt: 1,
        updatedAt: 1,
      },
      auth.dek,
    );
    seed(auth, 'Satu', { folderId });
    await t.c.providers.create(auth, {
      kind: 'openai-compatible',
      name: 'Lokal',
      baseUrl: 'http://127.0.0.1:9/v1',
      apiKey: KEY,
    });
    const file = (
      await t.c.exporter.exportData(auth, {
        format: 'neotext',
        passphrase: PW,
        includeProviderKeys: true,
      })
    ).data;
    // Admin: the bundle's provider has a private address, which only an admin may add.
    const other = await addUser(t, 'tamu', 'admin');
    await importer().importData(other.auth, { source: 'neotext', file, passphrase: PW });
    const again = await importer().importData(other.auth, {
      source: 'neotext',
      file,
      passphrase: PW,
    });
    expect(again).toEqual({ imported: 0, skipped: 1, failed: [] });
    expect(t.c.repos.folders.list(other.auth.userId, other.auth.dek)).toHaveLength(1);
    expect(t.c.providers.list(other.auth).filter((p) => !p.shared)).toHaveLength(1);
    // Re-importing your own export skips the chats you still have.
    const own = await importer().importData(auth, { source: 'neotext', file, passphrase: PW });
    expect(own).toMatchObject({ imported: 0, skipped: 1 });
  });

  test('settings restore is opt-in and keeps a snapshot', async () => {
    t.c.settings.patch(auth.userId, auth.dek, { locale: 'id' });
    const file = (await t.c.exporter.exportData(auth, { format: 'neotext', passphrase: PW })).data;
    const other = await addUser(t, 'tamu');
    t.c.settings.patch(other.auth.userId, other.auth.dek, { locale: 'en' });
    const before = t.c.settings.get(other.auth.userId, other.auth.dek);

    await importer().importData(other.auth, { source: 'neotext', file, passphrase: PW });
    expect(t.c.settings.get(other.auth.userId, other.auth.dek)).toEqual(before);

    await importer().importData(other.auth, {
      source: 'neotext',
      file,
      passphrase: PW,
      restoreSettings: true,
    });
    const after = t.c.settings.get(other.auth.userId, other.auth.dek);
    expect(after.settings.locale).toBe('id');
    expect(after.version).toBe(before.version + 1);
    const [snap] = t.c.settings.history(other.auth.userId);
    expect(snap).toMatchObject({ version: before.version, reason: 'restore' });
    // The snapshot holds the settings that were replaced.
    t.c.settings.restore(other.auth.userId, other.auth.dek, before.version);
    expect(t.c.settings.get(other.auth.userId, other.auth.dek).settings.locale).toBe('en');
  });

  test('settings from a file are validated, not stored as given', async () => {
    const file = await bundleFile((b) => {
      b.settings = { locale: 'klingon', appearance: 'nope' };
    });
    await importer().importData(auth, {
      source: 'neotext',
      file,
      passphrase: PW,
      restoreSettings: true,
    });
    const s = t.c.settings.get(auth.userId, auth.dek);
    expect(s.settings.locale).toBe('auto');
    expect(s.resetPaths).toEqual([]);
  });

  test('every row is validated; a bad conversation fails alone', async () => {
    const good = newId('cnv');
    const bad = newId('cnv');
    const cyclic = newId('cnv');
    const file = await bundleFile((b) => {
      b.folders = [{ id: 'fld_bad', name: 42 } as never];
      b.presets = [{ id: 'pst_bad', name: 'X', data: { systemPrompt: 5 } } as never];
      b.conversations = [
        summary({ id: good, title: 'Baik', activeLeafId: 'm_good' }),
        summary({ id: bad, title: 'Buruk' }),
        summary({ id: cyclic, title: 'Putar' }),
        { id: 'cnv_x', title: { evil: true } } as never,
      ];
      b.messages = [
        message({ id: 'm_good', conversationId: good }),
        message({ id: 'm_bad', conversationId: bad, parts: [{ type: 'mystery' }] as never }),
        message({ id: 'm_c1', conversationId: cyclic, parentId: 'm_c2' }),
        message({ id: 'm_c2', conversationId: cyclic, parentId: 'm_c1' }),
        message({ id: 'm_orphan', conversationId: 'cnv_nowhere' }),
      ];
    });
    const result = await importer().importData(auth, { source: 'neotext', file, passphrase: PW });
    expect(result.imported).toBe(1);
    expect(result.failed.map((f) => f.title)).toEqual(
      expect.arrayContaining(['Buruk', 'Putar', null]),
    );
    expect(result.failed.every((f) => f.reason.length > 0)).toBe(true);
    expect(all(auth).map((c) => c.title)).toEqual(['Baik']);
    expect(t.c.repos.folders.list(auth.userId, auth.dek)).toEqual([]);
    expect(t.c.presets.list(auth)).toEqual([]);
  });

  test('attachment parts become a note, and unfinished answers are marked interrupted', async () => {
    const id = newId('cnv');
    const file = await bundleFile((b) => {
      b.conversations = [
        summary({ id, activeLeafId: 'm2', folderId: 'fld_gone', presetId: 'pst_gone' }),
      ];
      b.messages = [
        message({
          id: 'm1',
          conversationId: id,
          parts: [
            {
              type: 'attachment',
              attachmentId: 'att_123',
              name: 'laporan.pdf',
              mime: 'application/pdf',
              size: 10,
            },
            { type: 'text', text: 'Ringkas ini' },
          ],
        }),
        message({
          id: 'm2',
          conversationId: id,
          parentId: 'm1',
          role: 'assistant',
          status: 'streaming',
          createdAt: 1001,
        }),
      ];
    });
    const result = await importer().importData(auth, { source: 'neotext', file, passphrase: PW });
    expect(result.attachmentNotes).toBe(1);
    const [c] = all(auth);
    if (!c) throw new Error('nothing imported');
    expect(c.folderId).toBeNull();
    expect(c.presetId).toBeNull();
    const d = detail(auth, c.id);
    expect(d.messages[0]?.parts).toEqual([
      { type: 'text', text: '[📎 laporan.pdf]' },
      { type: 'text', text: 'Ringkas ini' },
    ]);
    expect(JSON.stringify(d.messages)).not.toContain('att_123');
    expect(d.messages[1]?.status).toBe('interrupted');
    // The same file again is skipped whole, so it adds no notes.
    const again = await importer().importData(auth, { source: 'neotext', file, passphrase: PW });
    expect(again).toMatchObject({ imported: 0, skipped: 1 });
    expect(again.attachmentNotes).toBeUndefined();
  });

  test('names lose control and bidi characters; only web links survive as sources', async () => {
    const id = newId('cnv');
    const file = await bundleFile((b) => {
      b.folders = [
        {
          id: 'fld_1',
          parentId: null,
          name: 'Ku‮liah\u0000\tbaru',
          color: null,
          position: 'a0',
          createdAt: 1,
          updatedAt: 1,
        },
      ];
      b.conversations = [summary({ id, title: '⁦Bab⁩ satu\r\n', activeLeafId: 'm1' })];
      const source = (n: number, url: string) => ({
        n,
        url,
        title: 't',
        domain: 'd',
        snippet: 's',
      });
      b.messages = [
        message({
          id: 'm1',
          conversationId: id,
          role: 'assistant',
          parts: [
            { type: 'text', text: 'Jawab' },
            {
              type: 'sources',
              sources: [
                source(1, 'https://example.com/a'),
                source(2, 'javascript:alert(1)'),
                source(3, 'data:text/html,hi'),
                source(4, 'http://example.org'),
              ],
            },
            { type: 'sources', sources: [source(1, 'file:///etc/passwd')] },
          ],
        }),
      ];
    });
    await importer().importData(auth, { source: 'neotext', file, passphrase: PW });
    expect(t.c.repos.folders.list(auth.userId, auth.dek).map((f) => f.name)).toEqual([
      'Kuliah baru',
    ]);
    const [c] = all(auth);
    if (!c) throw new Error('nothing imported');
    expect(c.title).toBe('Bab satu');
    const parts = detail(auth, c.id).messages[0]?.parts ?? [];
    expect(parts.map((p) => p.type)).toEqual(['text', 'sources']);
    const sources = parts[1]?.type === 'sources' ? parts[1].sources : [];
    expect(sources.map((s) => s.url)).toEqual(['https://example.com/a', 'http://example.org']);
  });

  test('a provider that fails the endpoint checks is listed, the rest still imports', async () => {
    const id = newId('cnv');
    const file = await bundleFile((b) => {
      b.conversations = [summary({ id, activeLeafId: 'm1' })];
      b.messages = [message({ id: 'm1', conversationId: id })];
      b.providers = [
        {
          kind: 'openai-compatible',
          name: 'Metadata',
          baseUrl: 'http://169.254.169.254/v1',
          apiKey: KEY,
          headers: null,
          manualModels: [],
          category: 'llm',
        },
        { kind: 'openai-compatible', name: 'Tanpa alamat' } as never,
      ];
    });
    const result = await importer().importData(auth, { source: 'neotext', file, passphrase: PW });
    expect(result.imported).toBe(1);
    expect(result.failed).toEqual([
      {
        title: 'Metadata',
        code: 'provider_rejected',
        reason: "This address is reserved for cloud metadata and can't be used as an endpoint.",
      },
      {
        title: 'Tanpa alamat',
        code: 'invalid_provider',
        reason: 'A provider in the file is not valid, so it was skipped.',
      },
    ]);
    expect(t.c.providers.list(auth).filter((p) => !p.shared)).toEqual([]);
  });

  test('agents travel in the bundle; a name the user has is skipped', async () => {
    t.c.agents.create(auth, {
      name: 'Scout',
      data: {
        description: 'Finds things',
        instructions: 'Search well.',
        model: { providerId: 'prv_elsewhere', modelId: 'm' },
        tools: { webSearch: false, fetchUrl: true },
        autoDelegate: true,
        enabled: true,
      },
    });
    t.c.agents.create(auth, {
      name: 'Critic',
      data: {
        description: '',
        instructions: 'Be harsh.',
        model: null,
        tools: { webSearch: true, fetchUrl: true },
        autoDelegate: false,
        enabled: true,
      },
    });
    const file = (await t.c.exporter.exportData(auth, { format: 'neotext', passphrase: PW })).data;
    const other = await addUser(t, 'tamu');
    t.c.agents.create(other.auth, {
      name: 'critic',
      data: {
        description: '',
        instructions: 'Mine.',
        model: null,
        tools: { webSearch: true, fetchUrl: true },
        autoDelegate: false,
        enabled: true,
      },
    });
    const result = await importer().importData(other.auth, {
      source: 'neotext',
      file,
      passphrase: PW,
    });
    expect(result.failed).toEqual([]);
    const list = t.c.agents.list(other.auth);
    expect(list.map((a) => a.name).sort()).toEqual(['Scout', 'critic']);
    const scout = list.find((a) => a.name === 'Scout');
    // Sealed under the new owner's key with a new id; the unknown model is cleared.
    expect(t.c.agents.get(other.auth, scout?.id ?? '')?.data).toMatchObject({
      instructions: 'Search well.',
      model: null,
      tools: { webSearch: false, fetchUrl: true },
      autoDelegate: true,
    });
    expect(list.find((a) => a.name === 'critic')?.data.instructions).toBe('Mine.');
    expect(t.c.agents.list(auth).map((a) => a.id)).not.toContain(scout?.id);
  });
});
