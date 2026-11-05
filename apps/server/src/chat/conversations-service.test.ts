import { newId } from '@neotext/shared';
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  addUser,
  authContextFor,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';
import type { AuthContext } from '../http/env';
import { createConversationsService } from './conversations-service';

let t: TestApp;
let auth: AuthContext;
beforeEach(async () => {
  t = await createTestApp();
  auth = authContextFor(t, (await setupOwner(t)).cookie);
});
afterEach(async () => {
  await t.close();
});

const BASE = Date.UTC(2026, 0, 1);

function seed(title: string | null, createdAt: number, extra: { folderId?: string } = {}): string {
  const id = newId('cnv');
  t.c.repos.conversations.insert(
    { id, userId: auth.userId, folderId: extra.folderId ?? null, title, createdAt },
    auth.dek,
  );
  return id;
}

const ids = (r: { items: { id: string }[] }) => r.items.map((i) => i.id);

test('titles are encrypted at rest', () => {
  const created = t.c.conversations.create(auth, { title: 'Rencana skripsi' });
  const raw = t.c.db.raw
    .prepare('SELECT title FROM conversations WHERE id = ?')
    .get(created.id) as { title: Buffer };
  expect(Buffer.isBuffer(raw.title)).toBe(true);
  expect(raw.title.toString('utf8')).not.toContain('Rencana');
  expect(t.c.conversations.detail(auth, created.id).conversation.title).toBe('Rencana skripsi');
});

test('cursor pagination is complete and stable', () => {
  for (let i = 0; i < 120; i++) seed(`chat ${i}`, BASE + i * 1000);
  const seen: string[] = [];
  const times: number[] = [];
  const sizes: number[] = [];
  let cursor: string | undefined;
  let last: string | null = null;
  for (let page = 0; page < 3; page++) {
    const r = t.c.conversations.list(auth, { scope: 'recent', limit: 50, cursor });
    sizes.push(r.items.length);
    for (const it of r.items) {
      seen.push(it.id);
      times.push(it.lastActivityAt);
    }
    last = r.nextCursor;
    cursor = r.nextCursor ?? undefined;
  }
  expect(sizes).toEqual([50, 50, 20]);
  expect(last).toBeNull();
  expect(new Set(seen).size).toBe(120);
  for (let i = 1; i < times.length; i++) expect(times[i]).toBeLessThan(times[i - 1] as number);
});

test('equal timestamps do not skip or repeat rows', () => {
  for (let i = 0; i < 7; i++) seed(`same ${i}`, BASE);
  const a = t.c.conversations.list(auth, { scope: 'recent', limit: 3 });
  const b = t.c.conversations.list(auth, {
    scope: 'recent',
    limit: 3,
    cursor: a.nextCursor ?? undefined,
  });
  const c = t.c.conversations.list(auth, {
    scope: 'recent',
    limit: 3,
    cursor: b.nextCursor ?? undefined,
  });
  expect(new Set([...ids(a), ...ids(b), ...ids(c)]).size).toBe(7);
  expect(c.nextCursor).toBeNull();
});

test('recent excludes pinned, archived, foldered and deleted', () => {
  const folder = t.c.conversations.createFolder(auth, { name: 'F', position: 'a0' });
  const plain = seed('plain', BASE + 1);
  const pinned = seed('pinned', BASE + 2);
  const archived = seed('archived', BASE + 3);
  seed('foldered', BASE + 4, { folderId: folder.id });
  const deleted = seed('deleted', BASE + 5);
  t.c.conversations.update(auth, pinned, { pinned: true, pinPosition: 'a0' });
  t.c.conversations.update(auth, archived, { archived: true });
  t.c.conversations.remove(auth, deleted);
  expect(ids(t.c.conversations.list(auth, { scope: 'recent', limit: 50 }))).toEqual([plain]);
});

test('includeFoldered brings folder chats back into recent', () => {
  const folder = t.c.conversations.createFolder(auth, { name: 'F', position: 'a0' });
  const plain = seed('plain', BASE + 1);
  const foldered = seed('foldered', BASE + 4, { folderId: folder.id });
  expect(
    ids(t.c.conversations.list(auth, { scope: 'recent', limit: 50, includeFoldered: true })),
  ).toEqual([foldered, plain]);
  expect(
    ids(t.c.conversations.list(auth, { scope: 'folder', folderId: folder.id, limit: 50 })),
  ).toEqual([foldered]);
});

test('pinned are ordered by pinPosition', () => {
  const x = seed('x', BASE + 1);
  const y = seed('y', BASE + 2);
  const z = seed('z', BASE + 3);
  t.c.conversations.update(auth, x, { pinned: true, pinPosition: 'a1' });
  t.c.conversations.update(auth, y, { pinned: true, pinPosition: 'a0' });
  t.c.conversations.update(auth, z, { pinned: true, pinPosition: 'a2' });
  expect(ids(t.c.conversations.list(auth, { scope: 'pinned', limit: 50 }))).toEqual([y, x, z]);
});

test('title search across pages', () => {
  const hits = new Set<string>();
  const hitTitles: Record<number, string> = {
    10: 'Tugas kalkulus 10',
    77: 'Tugas KaLkuLus 77',
    140: 'KALKULUS 140',
  };
  for (let i = 0; i < 150; i++) {
    const title = hitTitles[i];
    const id = seed(title ?? `other ${i}`, BASE + i);
    if (title) hits.add(id);
  }
  const r = t.c.conversations.list(auth, { scope: 'all', titleContains: 'KALKULUS', limit: 50 });
  expect(new Set(ids(r))).toEqual(hits);
});

test('deleting a folder moves its contents up', () => {
  const p = t.c.conversations.createFolder(auth, { name: 'P', position: 'a0' });
  const c = t.c.conversations.createFolder(auth, { name: 'C', parentId: p.id, position: 'a0' });
  const g = t.c.conversations.createFolder(auth, { name: 'G', parentId: c.id, position: 'a0' });
  const x = seed('x', BASE, { folderId: c.id });
  t.clock.advance(60_000);
  const at = t.c.clock.now();
  t.c.conversations.removeFolder(auth, c.id);
  const moved = t.c.conversations.detail(auth, x).conversation;
  expect(moved).toMatchObject({ folderId: p.id, updatedAt: at });
  const folders = t.c.conversations.listFolders(auth);
  expect(folders.map((f) => f.id).sort()).toEqual([p.id, g.id].sort());
  expect(folders.find((f) => f.id === g.id)).toMatchObject({ parentId: p.id, updatedAt: at });
  expect(folders.find((f) => f.id === p.id)?.updatedAt).toBeLessThan(at);
});

test('folders nest at most 3 levels', () => {
  const a = t.c.conversations.createFolder(auth, { name: 'A', position: 'a0' });
  const b = t.c.conversations.createFolder(auth, { name: 'B', parentId: a.id, position: 'a0' });
  const c = t.c.conversations.createFolder(auth, { name: 'C', parentId: b.id, position: 'a0' });
  expect(() =>
    t.c.conversations.createFolder(auth, { name: 'D', parentId: c.id, position: 'a0' }),
  ).toThrowError(expect.objectContaining({ status: 400, code: 'bad_request' }));
  const other = t.c.conversations.createFolder(auth, { name: 'O', position: 'a1' });
  // moving a 3-level tree under another folder would make it 4 deep
  expect(() => t.c.conversations.updateFolder(auth, a.id, { parentId: other.id })).toThrowError(
    expect.objectContaining({ status: 400 }),
  );
  // a folder cannot move under its own descendant
  expect(() => t.c.conversations.updateFolder(auth, a.id, { parentId: c.id })).toThrowError(
    expect.objectContaining({ status: 400 }),
  );
  expect(t.c.conversations.updateFolder(auth, other.id, { parentId: a.id }).parentId).toBe(a.id);
});

test('trash and restore', () => {
  const id = seed('gone', BASE);
  t.c.conversations.remove(auth, id);
  expect(ids(t.c.conversations.list(auth, { scope: 'trash', limit: 50 }))).toEqual([id]);
  expect(t.c.conversations.list(auth, { scope: 'all', limit: 50 }).items).toEqual([]);
  expect(() => t.c.conversations.detail(auth, id)).toThrowError(
    expect.objectContaining({ status: 404 }),
  );
  t.clock.advance(60_000);
  const restored = t.c.conversations.restore(auth, id);
  expect(restored).toMatchObject({ deletedAt: null, updatedAt: t.c.clock.now() });
  expect(t.c.conversations.list(auth, { scope: 'trash', limit: 50 }).items).toEqual([]);
});

test('another user gets 404', async () => {
  const id = seed('mine', BASE);
  const other = (await addUser(t, 'mallory')).auth;
  const notFound = expect.objectContaining({ status: 404, code: 'not_found' });
  expect(() => t.c.conversations.detail(other, id)).toThrowError(notFound);
  expect(() => t.c.conversations.update(other, id, { title: 'x' })).toThrowError(notFound);
  expect(() => t.c.conversations.remove(other, id)).toThrowError(notFound);
  expect(() => t.c.conversations.restore(other, id)).toThrowError(notFound);
  expect(t.c.conversations.list(other, { scope: 'all', limit: 50 }).items).toEqual([]);
});

test('user title sets titleSource user', () => {
  const id = seed(null, BASE);
  const updated = t.c.conversations.update(auth, id, { title: 'Mine' });
  expect(updated.title).toBe('Mine');
  expect(updated.titleSource).toBe('user');
});

test('activeLeafId must belong to the conversation', () => {
  const a = seed('a', BASE);
  const b = seed('b', BASE + 1);
  const msgId = newId('msg');
  t.c.repos.messages.insert(
    {
      id: msgId,
      conversationId: a,
      userId: auth.userId,
      parentId: null,
      role: 'user',
      status: 'complete',
      parts: [{ type: 'text', text: 'hi' }],
      providerId: null,
      modelId: null,
      createdAt: BASE,
    },
    auth.dek,
  );
  expect(t.c.conversations.update(auth, a, { activeLeafId: msgId }).activeLeafId).toBe(msgId);
  expect(() => t.c.conversations.update(auth, b, { activeLeafId: msgId })).toThrowError(
    expect.objectContaining({
      status: 400,
      code: 'bad_request',
      message: 'That message is not part of this conversation.',
    }),
  );
});

test('delete forever requires the trash', () => {
  const id = seed('live', BASE);
  expect(() => t.c.conversations.deleteForever(auth, id)).toThrowError(
    expect.objectContaining({ status: 400 }),
  );
  t.c.conversations.remove(auth, id);
  t.c.conversations.deleteForever(auth, id);
  expect(t.c.conversations.list(auth, { scope: 'trash', limit: 50 }).items).toEqual([]);
  expect(() => t.c.conversations.deleteForever(auth, id)).toThrowError(
    expect.objectContaining({ status: 404 }),
  );
});

test('delete forever removes the messages too', () => {
  const id = seed('with messages', BASE);
  t.c.repos.messages.insert(
    {
      id: newId('msg'),
      conversationId: id,
      userId: auth.userId,
      parentId: null,
      role: 'user',
      status: 'complete',
      parts: [{ type: 'text', text: 'hi' }],
      providerId: null,
      modelId: null,
      createdAt: BASE,
    },
    auth.dek,
  );
  t.c.conversations.remove(auth, id);
  t.c.conversations.deleteForever(auth, id);
  const n = t.c.db.raw
    .prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?')
    .get(id) as { n: number };
  expect(n.n).toBe(0);
});

test('empty trash affects only this user', async () => {
  const mine = seed('mine', BASE);
  const keep = seed('still here', BASE + 1);
  t.c.conversations.remove(auth, mine);
  const other = (await addUser(t, 'mallory')).auth;
  const theirs = t.c.conversations.create(other, { title: 'theirs' }).id;
  t.c.conversations.remove(other, theirs);

  expect(t.c.conversations.emptyTrash(auth)).toEqual({ purged: 1 });
  expect(t.c.conversations.list(auth, { scope: 'trash', limit: 50 }).items).toEqual([]);
  expect(ids(t.c.conversations.list(auth, { scope: 'all', limit: 50 }))).toEqual([keep]);
  expect(ids(t.c.conversations.list(other, { scope: 'trash', limit: 50 }))).toEqual([theirs]);
  expect(() => t.c.conversations.deleteForever(other, mine)).toThrowError(
    expect.objectContaining({ status: 404 }),
  );
});

test('delete forever and empty trash pass the purged ids to the hook', () => {
  const hooked: string[][] = [];
  const service = createConversationsService({
    db: t.c.db,
    conversations: t.c.repos.conversations,
    messages: t.c.repos.messages,
    folders: t.c.repos.folders,
    attachments: t.c.attachments,
    clock: t.c.clock,
    onPurged: (purged) => hooked.push(purged),
  });
  const one = seed('one', BASE);
  const two = seed('two', BASE + 1);
  const three = seed('three', BASE + 2);
  for (const id of [one, two, three]) service.remove(auth, id);
  service.deleteForever(auth, one);
  expect(hooked).toEqual([[one]]);
  service.emptyTrash(auth);
  expect(hooked).toHaveLength(2);
  expect([...(hooked[1] ?? [])].sort()).toEqual([two, three].sort());
  service.emptyTrash(auth);
  expect(hooked).toHaveLength(2);
});
