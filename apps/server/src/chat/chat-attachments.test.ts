import fs from 'node:fs';
import path from 'node:path';
import { ATTACHMENT_UNAVAILABLE_ID, type MessagePart, type StreamEvent } from '@neotext/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PNG_BYTES } from '../../test-support/attachment-bytes';
import { type MockProvider, startMockProvider } from '../../test-support/mock-provider';
import { readEvents } from '../../test-support/sse-client';
import { textFrames } from '../../test-support/sse-frames';
import {
  addUser,
  authContextFor,
  authed,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';

let t: TestApp;
let mock: MockProvider;
let api: ReturnType<typeof authed>;
let cookie: string;
let providerId: string;

beforeEach(async () => {
  t = await createTestApp();
  mock = await startMockProvider();
  mock.models = ['m1'];
  cookie = (await setupOwner(t)).cookie;
  api = authed(t, cookie);
  const res = await api('/api/providers', {
    method: 'POST',
    body: JSON.stringify({ kind: 'openai-compatible', name: 'Mock', baseUrl: mock.url }),
  });
  providerId = ((await res.json()) as { provider: { id: string } }).provider.id;
  await api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({ patch: { chat: { includeDate: false, autoTitle: false } } }),
  });
});
afterEach(async () => {
  await t.close();
  await mock.close();
});

const upload = (name: string, mime: string, bytes: Buffer, as = cookie) =>
  t.c.attachments.upload(authContextFor(t, as), { name, mime, bytes });

const send = async (
  attachmentIds: string[],
  as: typeof api = api,
  over: { conversationId?: string; parentId?: string | null; text?: string; key?: string } = {},
) => {
  mock.requests.length = 0;
  mock.enqueue({ frames: textFrames('ok') });
  const res = await as('/api/chat', {
    method: 'POST',
    ...(over.key ? { headers: { 'Idempotency-Key': over.key } } : {}),
    body: JSON.stringify({
      conversationId: over.conversationId ?? null,
      parentId: over.parentId ?? null,
      userMessage: { text: over.text ?? 'Read this', attachmentIds },
      targets: [{ providerId, modelId: 'm1' }],
    }),
  });
  if (res.status !== 200) return { res, evs: [] as StreamEvent[], sent: null };
  const evs = await readEvents(res);
  const sent = mock.requests.find((r) => r.path === '/v1/chat/completions')?.body as {
    messages: { role: string; content: unknown }[];
  };
  return { res, evs, sent };
};

test('a turn sends attached text and links the upload to the user message', async () => {
  const txt = await upload('notes.txt', 'text/plain', Buffer.from('halo dunia'));
  const img = await upload('cat.png', 'image/png', PNG_BYTES);
  const { res, sent } = await send([txt.id, img.id]);
  expect(res.status).toBe(200);
  const user = sent?.messages.find((m) => m.role === 'user');
  // `m1` is not in the model cache here, so it counts as unknown: images and files both go.
  expect(user?.content).toEqual([
    { type: 'text', text: 'Read this\n\n```notes.txt\nhalo dunia\n```' },
    {
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${PNG_BYTES.toString('base64')}` },
    },
  ]);
  const row = t.c.db.raw
    .prepare('SELECT conversation_id, message_id FROM attachments WHERE id = ?')
    .get(txt.id) as { conversation_id: string; message_id: string };
  const stored = t.c.repos.messages.get(row.message_id, authContextFor(t, cookie).dek);
  expect(stored?.conversationId).toBe(row.conversation_id);
  expect(stored?.parts.filter((p: MessagePart) => p.type === 'attachment')).toEqual([
    { type: 'attachment', attachmentId: txt.id, name: 'notes.txt', mime: 'text/plain', size: 10 },
    { type: 'attachment', attachmentId: img.id, name: 'cat.png', mime: 'image/png', size: 16 },
  ]);
});

test('an upload already sent, or another user’s, is refused and nothing is written', async () => {
  const txt = await upload('notes.txt', 'text/plain', Buffer.from('halo'));
  expect((await send([txt.id])).res.status).toBe(200);
  const again = await send([txt.id]);
  expect(again.res.status).toBe(400);

  const other = await addUser(t, 'mallory');
  const theirs = await upload('x.txt', 'text/plain', Buffer.from('x'), other.cookie);
  const before = t.c.db.raw.prepare('SELECT count(*) AS n FROM conversations').get();
  expect((await send([theirs.id])).res.status).toBe(400);
  expect(t.c.db.raw.prepare('SELECT count(*) AS n FROM conversations').get()).toEqual(before);
});

const linkOf = (id: string) =>
  t.c.db.raw
    .prepare('SELECT conversation_id, message_id FROM attachments WHERE id = ?')
    .get(id) as { conversation_id: string; message_id: string };

test('an edited message keeps its files as copies of its own', async () => {
  const txt = await upload('notes.txt', 'text/plain', Buffer.from('halo dunia'));
  expect((await send([txt.id])).res.status).toBe(200);
  const original = linkOf(txt.id);
  // The edit is a sibling of the first message: same parent (the root), same files.
  const edit = await send([txt.id], api, {
    conversationId: original.conversation_id,
    parentId: null,
    text: 'Read this again',
  });
  expect(edit.res.status).toBe(200);
  const user = edit.sent?.messages.find((m) => m.role === 'user');
  expect(user?.content).toBe('Read this again\n\n```notes.txt\nhalo dunia\n```');
  const dek = authContextFor(t, cookie).dek;
  const rows = t.c.db.raw
    .prepare('SELECT id, message_id FROM attachments ORDER BY created_at, id')
    .all() as { id: string; message_id: string }[];
  expect(rows).toHaveLength(2);
  const copy = rows.find((r) => r.id !== txt.id);
  expect(copy?.message_id).not.toBe(original.message_id);
  const edited = t.c.repos.messages.get(copy?.message_id as string, dek);
  expect(edited?.parts).toContainEqual(
    expect.objectContaining({ type: 'attachment', attachmentId: copy?.id, name: 'notes.txt' }),
  );
  // The original message still owns the original upload.
  expect(linkOf(txt.id)).toEqual(original);
});

test('a message can be files only', async () => {
  const txt = await upload('notes.txt', 'text/plain', Buffer.from('halo'));
  const { res, sent } = await send([txt.id], api, { text: '' });
  expect(res.status).toBe(200);
  expect(sent?.messages.find((m) => m.role === 'user')?.content).toBe('```notes.txt\nhalo\n```');
  expect((await send([], api, { text: '' })).res.status).toBe(400);
});

test('a failed turn discards the copies made for it', async () => {
  const txt = await upload('notes.txt', 'text/plain', Buffer.from('halo'));
  expect((await send([txt.id])).res.status).toBe(200);
  const { conversation_id } = linkOf(txt.id);
  // Not a sibling of anything: the parent does not exist, so the turn is refused after the copy.
  const res = await send([txt.id], api, { conversationId: conversation_id, parentId: 'msg_nope' });
  expect(res.res.status).toBe(400);
  expect(t.c.db.raw.prepare('SELECT count(*) AS n FROM attachments').get()).toEqual({ n: 1 });
});

test('an edit of a message whose file vanished keeps it as unavailable', async () => {
  const txt = await upload('notes.txt', 'text/plain', Buffer.from('halo'));
  expect((await send([txt.id])).res.status).toBe(200);
  const original = linkOf(txt.id);
  fs.rmSync(path.join(t.dataDir, 'attachments', authContextFor(t, cookie).userId, `${txt.id}.bin`));
  const edit = await send([txt.id], api, {
    conversationId: original.conversation_id,
    parentId: null,
    text: 'again',
  });
  expect(edit.res.status).toBe(200);
  expect(edit.sent?.messages.find((m) => m.role === 'user')?.content).toBe(
    'again\n\n[Attachment "notes.txt" is no longer available.]',
  );
  const dek = authContextFor(t, cookie).dek;
  const edited = edit.evs.find((e) => e.type === 'generation.started') as
    | { userMessage: { id: string } }
    | undefined;
  const stored = t.c.repos.messages.get(edited?.userMessage.id as string, dek);
  expect(stored?.parts).toContainEqual({
    type: 'attachment',
    attachmentId: ATTACHMENT_UNAVAILABLE_ID,
    name: 'notes.txt',
    mime: 'text/plain',
    size: 4,
  });
});

test('a retried send with the same key copies and opens nothing', async () => {
  const txt = await upload('notes.txt', 'text/plain', Buffer.from('halo'));
  expect((await send([txt.id])).res.status).toBe(200);
  const { conversation_id } = linkOf(txt.id);
  const over = { conversationId: conversation_id, parentId: null, text: 'edit', key: 'k-1' };
  expect((await send([txt.id], api, over)).res.status).toBe(200);
  const count = () => t.c.db.raw.prepare('SELECT count(*) AS n FROM attachments').get();
  expect(count()).toEqual({ n: 2 });
  const prepare = vi.spyOn(t.c.attachments, 'prepareReuse');
  const load = vi.spyOn(t.c.attachments, 'loadForTurn');
  const retry = await api('/api/chat', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'k-1' },
    body: JSON.stringify({
      conversationId: conversation_id,
      parentId: null,
      userMessage: { text: 'edit', attachmentIds: [txt.id] },
      targets: [{ providerId, modelId: 'm1' }],
    }),
  });
  expect(retry.status).toBe(200);
  await retry.body?.cancel();
  expect(prepare).not.toHaveBeenCalled();
  expect(load).not.toHaveBeenCalled();
  expect(count()).toEqual({ n: 2 });
});
