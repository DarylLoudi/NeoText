import fs from 'node:fs';
import path from 'node:path';
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_UNAVAILABLE_ID, newId } from '@neotext/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PDF_BYTES, PNG_BYTES } from '../../test-support/attachment-bytes';
import {
  addUser,
  authContextFor,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';
import { aad } from '../crypto/aad';
import { openText } from '../crypto/aead';
import type { AuthContext } from '../http/env';
import { TURN_ATTACHMENT_BUDGET } from './service';

let t: TestApp;
let auth: AuthContext;

beforeEach(async () => {
  t = await createTestApp();
  auth = authContextFor(t, (await setupOwner(t)).cookie);
});
afterEach(() => t.close());

const service = () => t.c.attachments;
const fileOf = (userId: string, id: string) =>
  path.join(t.dataDir, 'attachments', userId, `${id}.bin`);

/** A conversation with one user message, written straight through the repos. */
function conversationWith(attachmentIds: string[] = []): {
  conversationId: string;
  messageId: string;
} {
  const conversationId = newId('cnv');
  const messageId = newId('msg');
  const now = t.clock.now();
  t.c.repos.conversations.insert(
    { id: conversationId, userId: auth.userId, folderId: null, title: 'C', createdAt: now },
    auth.dek,
  );
  const parts = service().attach(auth, attachmentIds, conversationId, messageId);
  t.c.repos.messages.insert(
    {
      id: messageId,
      conversationId,
      userId: auth.userId,
      parentId: null,
      role: 'user',
      status: 'complete',
      parts: [{ type: 'text', text: 'see file' }, ...parts],
      providerId: null,
      modelId: null,
      createdAt: now,
    },
    auth.dek,
  );
  t.c.repos.conversations.recordTurn(conversationId, now, messageId, 1, {
    providerId: 'p',
    modelId: 'm',
  });
  return { conversationId, messageId };
}

const upload = (name = 'notes.txt', mime = 'text/plain', bytes = Buffer.from('secret halo')) =>
  service().upload(auth, { name, mime, bytes });

test('mismatched content is rejected', async () => {
  await expect(
    service().upload(auth, {
      name: 'cat.png',
      mime: 'image/png',
      bytes: Buffer.from('<html>hi</html>'),
    }),
  ).rejects.toMatchObject({
    code: 'unsupported_media_type',
    status: 415,
    message: "This file's content doesn't match its type.",
    details: { reason: 'content_mismatch' },
  });
  await expect(upload('a.pdf', 'application/pdf', PNG_BYTES)).rejects.toMatchObject({
    code: 'unsupported_media_type',
  });
});

test('unknown types are rejected', async () => {
  await expect(
    upload('setup.exe', 'application/x-msdownload', Buffer.from([0x4d, 0x5a, 0, 0])),
  ).rejects.toMatchObject({
    code: 'unsupported_media_type',
    message: "This file type isn't supported.",
  });
  await expect(upload('page.svg', 'image/svg+xml', Buffer.from('<svg/>'))).rejects.toMatchObject({
    code: 'unsupported_media_type',
  });
});

test('size limit', async () => {
  const big = Buffer.alloc(ATTACHMENT_MAX_BYTES + 1, 0x61);
  await expect(upload('big.txt', 'text/plain', big)).rejects.toMatchObject({
    code: 'payload_too_large',
    status: 413,
  });
  await expect(upload('empty.txt', 'text/plain', Buffer.alloc(0))).rejects.toMatchObject({
    status: 400,
  });
});

test('code files are stored as plain text', async () => {
  const att = await upload('main.ts', 'video/mp2t', Buffer.from('const a = 1;'));
  expect(att.mime).toBe('text/plain');
  expect((await upload('notes.md', 'text/markdown')).mime).toBe('text/markdown');
});

test('sealed on disk', async () => {
  const att = await upload('Secret plan.txt', 'text/plain', Buffer.from('secret halo'));
  expect(att).toMatchObject({ name: 'Secret plan.txt', mime: 'text/plain', size: 11 });
  const onDisk = fs.readFileSync(fileOf(auth.userId, att.id));
  expect(onDisk.includes(Buffer.from('secret halo'))).toBe(false);
  const row = t.c.db.raw
    .prepare('SELECT name, sha256, size FROM attachments WHERE id = ?')
    .get(att.id) as { name: Buffer; sha256: string; size: number };
  expect(row.name.toString('utf8')).not.toContain('Secret');
  expect(openText(auth.dek, row.name, aad('attachments', 'name', att.id))).toBe('Secret plan.txt');
  expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
  const read = await service().read(auth, att.id);
  expect(read.bytes.toString('utf8')).toBe('secret halo');
  expect(read.attachment).toEqual(att);
});

test('other users get 404', async () => {
  const att = await upload();
  const other = await addUser(t, 'mallory');
  expect(() => service().get(other.auth, att.id)).toThrow(expect.objectContaining({ status: 404 }));
  await expect(service().read(other.auth, att.id)).rejects.toMatchObject({ status: 404 });
  expect(() => service().attach(other.auth, [att.id], newId('cnv'), newId('msg'))).toThrow(
    expect.objectContaining({ status: 400 }),
  );
});

test('an attachment goes on one message only', async () => {
  const att = await upload();
  const first = conversationWith([att.id]);
  expect(t.c.db.raw.prepare('SELECT message_id FROM attachments').get()).toEqual({
    message_id: first.messageId,
  });
  expect(() => service().attach(auth, [att.id], newId('cnv'), newId('msg'))).toThrow(
    expect.objectContaining({ status: 400 }),
  );
  expect(() => service().attach(auth, ['att_missing'], newId('cnv'), newId('msg'))).toThrow(
    expect.objectContaining({ status: 400 }),
  );
});

test('deleting a conversation forever removes its files', async () => {
  const att = await upload('a.pdf', 'application/pdf', PDF_BYTES);
  const kept = await upload('b.txt');
  const { conversationId } = conversationWith([att.id]);
  conversationWith([kept.id]);
  t.c.conversations.remove(auth, conversationId);
  t.c.conversations.deleteForever(auth, conversationId);
  expect(fs.existsSync(fileOf(auth.userId, att.id))).toBe(false);
  expect(() => service().get(auth, att.id)).toThrow(expect.objectContaining({ status: 404 }));
  expect(fs.existsSync(fileOf(auth.userId, kept.id))).toBe(true);
});

test('a purge with a missing file still clears the rows and never throws', async () => {
  const att = await upload();
  const { conversationId } = conversationWith([att.id]);
  fs.rmSync(fileOf(auth.userId, att.id));
  expect(() => service().purgeForConversations([conversationId])).not.toThrow();
  expect(t.c.db.raw.prepare('SELECT count(*) AS n FROM attachments').get()).toEqual({ n: 0 });
});

test('a fork keeps working after the original is deleted forever', async () => {
  const att = await upload('a.pdf', 'application/pdf', PDF_BYTES);
  const { conversationId, messageId } = conversationWith([att.id]);
  const copy = await t.c.conversations.fork(auth, conversationId, messageId);
  const [forked] = t.c.repos.messages.listForConversation(copy.id, auth.dek);
  const part = forked?.parts.find((p) => p.type === 'attachment');
  expect(part).toMatchObject({ type: 'attachment', name: 'a.pdf', mime: 'application/pdf' });
  const copiedId = (part as { attachmentId: string }).attachmentId;
  expect(copiedId).not.toBe(att.id);

  t.c.conversations.remove(auth, conversationId);
  t.c.conversations.deleteForever(auth, conversationId);
  const read = await service().read(auth, copiedId);
  expect(read.bytes.equals(PDF_BYTES)).toBe(true);
  expect(fs.existsSync(fileOf(auth.userId, att.id))).toBe(false);

  t.c.conversations.remove(auth, copy.id);
  t.c.conversations.deleteForever(auth, copy.id);
  expect(fs.existsSync(fileOf(auth.userId, copiedId))).toBe(false);
});

test('orphans are cleaned after 24 hours', async () => {
  const orphan = await upload('old.txt');
  const used = await upload('used.txt');
  conversationWith([used.id]);
  t.clock.advance(23 * 3_600_000);
  const fresh = await upload('fresh.txt');
  expect(service().purgeOrphans(t.clock.now() - 24 * 3_600_000)).toBe(0);
  t.clock.advance(2 * 3_600_000);
  expect(service().purgeOrphans(t.clock.now() - 24 * 3_600_000)).toBe(1);
  expect(fs.existsSync(fileOf(auth.userId, orphan.id))).toBe(false);
  expect(service().get(auth, fresh.id).id).toBe(fresh.id);
  expect(service().get(auth, used.id).id).toBe(used.id);
});

test('a turn opens files for the owner only', async () => {
  const att = await upload('n.txt', 'text/plain', Buffer.from('halo'));
  const mine = await service().loadForTurn(auth, { uploadIds: [att.id], messageIds: [] });
  const file = mine.get(att.id);
  expect(file).toMatchObject({ name: 'n.txt', mime: 'text/plain' });
  expect(file !== 'over-budget' && file?.text()).toEqual({ text: 'halo', cut: false });
  const other = await addUser(t, 'mallory');
  const theirs = await service().loadForTurn(other.auth, { uploadIds: [att.id], messageIds: [] });
  expect(theirs.has(att.id)).toBe(false);
});

test('the turn budget keeps the newest files and never reads the rest', async () => {
  // Three 20 MiB images against a 50 MiB budget: the oldest one does not fit.
  const big = (n: number) =>
    upload(
      `p${n}.png`,
      'image/png',
      Buffer.concat([PNG_BYTES, Buffer.alloc(20 * 1024 * 1024 - 16)]),
    );
  const [a, b, c] = [await big(1), await big(2), await big(3)];
  const oldest = conversationWith([a.id]).messageId;
  const middle = conversationWith([b.id]).messageId;
  const read = vi.spyOn(fs.promises, 'readFile');
  const loaded = await service().loadForTurn(auth, {
    uploadIds: [c.id],
    messageIds: [middle, oldest],
  });
  expect(loaded.get(c.id)).toMatchObject({ name: 'p3.png' });
  expect(loaded.get(b.id)).toMatchObject({ name: 'p2.png' });
  expect(loaded.get(a.id)).toBe('over-budget');
  expect(read).toHaveBeenCalledTimes(2);
  read.mockRestore();
});

test('a file that cannot be removed keeps its row for the next sweep', async () => {
  const att = await upload();
  const { conversationId } = conversationWith([att.id]);
  // A directory where the file was: removing it fails.
  fs.rmSync(fileOf(auth.userId, att.id));
  fs.mkdirSync(path.join(fileOf(auth.userId, att.id), 'x'), { recursive: true });
  service().purgeForConversations([conversationId]);
  expect(t.c.db.raw.prepare('SELECT count(*) AS n FROM attachments').get()).toEqual({ n: 1 });
  fs.rmSync(fileOf(auth.userId, att.id), { recursive: true });
  service().purgeForConversations([conversationId]);
  expect(t.c.db.raw.prepare('SELECT count(*) AS n FROM attachments').get()).toEqual({ n: 0 });
});

test('the sweep removes files whose conversation is gone', async () => {
  const att = await upload();
  const { conversationId } = conversationWith([att.id]);
  // A delete that skipped the purge hook.
  t.c.db.raw.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
  expect(service().purgeOrphans(t.clock.now() - 24 * 3_600_000)).toBe(1);
  expect(fs.existsSync(fileOf(auth.userId, att.id))).toBe(false);
  expect(t.c.db.raw.prepare('SELECT count(*) AS n FROM attachments').get()).toEqual({ n: 0 });
});

test('a fork of a file that is gone gets an unavailable part, not the shared id', async () => {
  const att = await upload('a.pdf', 'application/pdf', PDF_BYTES);
  const { conversationId, messageId } = conversationWith([att.id]);
  fs.rmSync(fileOf(auth.userId, att.id));
  const copy = await t.c.conversations.fork(auth, conversationId, messageId);
  const [forked] = t.c.repos.messages.listForConversation(copy.id, auth.dek);
  expect(forked?.parts.find((p) => p.type === 'attachment')).toEqual({
    type: 'attachment',
    attachmentId: ATTACHMENT_UNAVAILABLE_ID,
    name: 'a.pdf',
    mime: 'application/pdf',
    size: PDF_BYTES.length,
  });
});

test('a failed fork leaves no copied files behind', async () => {
  const att = await upload('a.pdf', 'application/pdf', PDF_BYTES);
  const { conversationId, messageId } = conversationWith([att.id]);
  const update = vi.spyOn(t.c.repos.conversations, 'update').mockImplementationOnce(() => {
    throw new Error('disk full');
  });
  await expect(t.c.conversations.fork(auth, conversationId, messageId)).rejects.toThrow(
    'disk full',
  );
  update.mockRestore();
  const ids = t.c.db.raw.prepare('SELECT id FROM attachments').all() as { id: string }[];
  expect(ids).toEqual([{ id: att.id }]);
  expect(fs.readdirSync(path.join(t.dataDir, 'attachments', auth.userId))).toEqual([
    `${att.id}.bin`,
  ]);
});

test('account deletion removes the user folder', async () => {
  await upload();
  await service().removeUserFiles(auth.userId);
  expect(fs.existsSync(path.join(t.dataDir, 'attachments', auth.userId))).toBe(false);
  await expect(service().removeUserFiles(auth.userId)).resolves.toBeUndefined();
});

test('large text files count their full stored size against the budget', async () => {
  // Text sends only a 400 KB head, but each sealed file is read and opened whole.
  const MiB = 1024 * 1024;
  const ids: string[] = [];
  const messageIds: string[] = [];
  for (let n = 0; n < 4; n += 1) {
    const att = await upload(`log${n}.txt`, 'text/plain', Buffer.alloc(20 * MiB, 0x61));
    ids.push(att.id);
    messageIds.unshift(conversationWith([att.id]).messageId);
  }
  const read = vi.spyOn(fs.promises, 'readFile');
  const loaded = await service().loadForTurn(auth, { uploadIds: [], messageIds });
  const bytesRead = (
    await Promise.all(read.mock.results.map((r) => r.value as Promise<Buffer>))
  ).reduce((n, b) => n + b.length, 0);
  expect(read).toHaveBeenCalledTimes(2);
  read.mockRestore();
  // The two newest fit in 50 MiB; the two oldest get the note and are never read.
  expect(loaded.get(ids[3] as string)).toMatchObject({ name: 'log3.txt' });
  expect(loaded.get(ids[2] as string)).toMatchObject({ name: 'log2.txt' });
  expect(loaded.get(ids[1] as string)).toBe('over-budget');
  expect(loaded.get(ids[0] as string)).toBe('over-budget');
  expect(bytesRead).toBeLessThanOrEqual(TURN_ATTACHMENT_BUDGET + 2 * 64);
});

test('a turn reads at most four files at once', async () => {
  const ids: string[] = [];
  for (let n = 0; n < 9; n += 1) ids.push((await upload(`n${n}.txt`)).id);
  const original = fs.promises.readFile.bind(fs.promises);
  let inFlight = 0;
  let peak = 0;
  const read = vi.spyOn(fs.promises, 'readFile').mockImplementation((async (
    ...args: Parameters<typeof fs.promises.readFile>
  ) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    try {
      return await original(...args);
    } finally {
      inFlight -= 1;
    }
  }) as typeof fs.promises.readFile);
  const loaded = await service().loadForTurn(auth, { uploadIds: ids, messageIds: [] });
  read.mockRestore();
  expect([...loaded.values()].every((v) => v !== null && v !== 'over-budget')).toBe(true);
  expect(peak).toBe(4);
});

test('a copy whose write fails leaves no partial file', async () => {
  const att = await upload();
  const write = vi.spyOn(fs.promises, 'writeFile').mockImplementationOnce((async (
    file: Parameters<typeof fs.promises.writeFile>[0],
  ) => {
    fs.writeFileSync(file as string, 'partial');
    throw new Error('disk full');
  }) as typeof fs.promises.writeFile);
  await expect(service().copyAsUpload(auth, att.id)).rejects.toThrow('disk full');
  write.mockRestore();
  expect(fs.readdirSync(path.join(t.dataDir, 'attachments', auth.userId))).toEqual([
    `${att.id}.bin`,
  ]);
});
