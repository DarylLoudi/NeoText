import { type MessagePublic, newId } from '@neotext/shared';
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  addUser,
  authContextFor,
  authed,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';
import type { AuthContext } from '../http/env';
import { forkConversation } from './fork';

let t: TestApp;
let auth: AuthContext;
let cookie: string;
let cid: string;
const ref = { providerId: 'prv_1', modelId: 'acme/neo-1' };
beforeEach(async () => {
  t = await createTestApp();
  cookie = (await setupOwner(t)).cookie;
  auth = authContextFor(t, cookie);
  cid = t.c.conversations.create(auth, { title: 'Rencana' }).id;
});
afterEach(async () => {
  await t.close();
});

const deps = () => ({
  db: t.c.db,
  conversations: t.c.repos.conversations,
  messages: t.c.repos.messages,
  clock: t.c.clock,
  attachments: t.c.attachments,
});

function add(
  text: string,
  parentId: string | null,
  role: 'user' | 'assistant',
  createdAt: number,
  status: 'complete' | 'streaming' = 'complete',
  conversationId = cid,
) {
  const id = newId('msg');
  t.c.repos.messages.insert(
    {
      id,
      conversationId,
      userId: auth.userId,
      parentId,
      role,
      status,
      parts: [{ type: 'text', text }],
      providerId: role === 'assistant' ? ref.providerId : null,
      modelId: role === 'assistant' ? ref.modelId : null,
      createdAt,
    },
    auth.dek,
  );
  return { id };
}

const textOf = (m: MessagePublic) => {
  const p = m.parts[0];
  return p && p.type === 'text' ? p.text : '';
};

function tree() {
  const u1 = add('u1', null, 'user', 1000);
  const a1 = add('a1', u1.id, 'assistant', 2000);
  const a1b = add('a1b', u1.id, 'assistant', 2500);
  const u2 = add('u2', a1.id, 'user', 3000);
  const a2 = add('a2', u2.id, 'assistant', 4000);
  return { u1, a1, a1b, u2, a2 };
}

test('copies only the path, under new ids', async () => {
  const { u1, a1, u2, a2 } = tree();
  t.c.repos.conversations.update(
    auth.userId,
    cid,
    { modelRef: ref, presetId: 'pre_1', activeLeafId: a2.id },
    5000,
    auth.dek,
  );
  const copy = await forkConversation(deps(), auth, cid, a2.id);
  const detail = t.c.conversations.detail(auth, copy.id);
  expect(detail.messages.map(textOf)).toEqual(['u1', 'a1', 'u2', 'a2']);
  expect(detail.messages.every((m) => ![u1.id, a1.id, u2.id, a2.id].includes(m.id))).toBe(true);
  expect(detail.messages.map((m) => m.createdAt)).toEqual([1000, 2000, 3000, 4000]);
  const [m1, m2, m3, m4] = detail.messages;
  expect([m1?.parentId, m2?.parentId, m3?.parentId, m4?.parentId]).toEqual([
    null,
    m1?.id,
    m2?.id,
    m3?.id,
  ]);
  expect(detail.messages.every((m) => m.conversationId === copy.id)).toBe(true);
  expect(detail.conversation.activeLeafId).toBe(detail.messages.at(-1)?.id);
  expect(detail.conversation.title).toBe('Rencana (copy)');
  expect(detail.conversation.titleSource).toBe('user');
  expect(detail.conversation.messageCount).toBe(4);
  expect(detail.conversation.modelRef).toEqual(ref);
  expect(detail.conversation.presetId).toBe('pre_1');
});

test('forking at a user message ends the copy there; streaming becomes interrupted', async () => {
  const u1 = add('u1', null, 'user', 1000);
  const a1 = add('a1', u1.id, 'assistant', 2000, 'streaming');
  const u2 = add('u2', a1.id, 'user', 3000);
  const copy = await forkConversation(deps(), auth, cid, u2.id);
  const detail = t.c.conversations.detail(auth, copy.id);
  expect(detail.messages.map(textOf)).toEqual(['u1', 'a1', 'u2']);
  expect(detail.messages.map((m) => m.status)).toEqual(['complete', 'interrupted', 'complete']);
  expect(detail.conversation.activeLeafId).toBe(detail.messages.at(-1)?.id);
});

test('copied parts are sealed under the new ids', async () => {
  const { u1 } = tree();
  const copy = await forkConversation(deps(), auth, cid, u1.id);
  const row = t.c.db.raw
    .prepare('SELECT id, parts FROM messages WHERE conversation_id = ?')
    .get(copy.id) as { id: string; parts: Buffer };
  expect(row.parts.toString('utf8')).not.toContain('u1');
  expect(t.c.repos.messages.get(row.id, auth.dek)?.parts).toEqual([{ type: 'text', text: 'u1' }]);
});

test('the original is untouched', async () => {
  const { a2 } = tree();
  const before = t.c.conversations.detail(auth, cid);
  await forkConversation(deps(), auth, cid, a2.id);
  expect(t.c.conversations.detail(auth, cid)).toEqual(before);
});

test('another user cannot fork', async () => {
  const { a2 } = tree();
  const other = await addUser(t, 'mallory');
  await expect(forkConversation(deps(), other.auth, cid, a2.id)).rejects.toMatchObject({
    status: 404,
  });
});

test('message from another conversation is refused', async () => {
  tree();
  const otherCid = t.c.conversations.create(auth, { title: 'Lain' }).id;
  const foreign = add('x', null, 'user', 1000, 'complete', otherCid);
  await expect(forkConversation(deps(), auth, cid, foreign.id)).rejects.toMatchObject({
    status: 400,
  });
});

test('POST /fork returns 201 with the copy', async () => {
  const { a2 } = tree();
  const api = authed(t, cookie);
  const res = await api(`/api/conversations/${cid}/fork`, {
    method: 'POST',
    body: JSON.stringify({ messageId: a2.id }),
  });
  expect(res.status).toBe(201);
  const copy = (await res.json()) as { id: string; title: string };
  expect(copy.id).not.toBe(cid);
  expect(copy.title).toBe('Rencana (copy)');
  const bad = await api(`/api/conversations/${cid}/fork`, { method: 'POST', body: '{}' });
  expect(bad.status).toBe(400);
});
