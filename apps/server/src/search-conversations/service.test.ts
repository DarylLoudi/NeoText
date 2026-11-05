import { newId } from '@neotext/shared';
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
import { foldText, makeSnippet, SEARCH_BUDGET_MS, searchConversations } from './service';

let t: TestApp;
let auth: AuthContext;
let cookie: string;
beforeEach(async () => {
  t = await createTestApp();
  cookie = (await setupOwner(t)).cookie;
  auth = authContextFor(t, cookie);
});
afterEach(async () => {
  await t.close();
});

const BASE = Date.UTC(2026, 0, 1);
let tick = 0;

function seedChat(
  title: string | null,
  texts: string[],
  owner: AuthContext = auth,
): { id: string; messageIds: string[] } {
  const at = BASE + ++tick * 1000;
  const id = newId('cnv');
  t.c.repos.conversations.insert(
    { id, userId: owner.userId, folderId: null, title, createdAt: at },
    owner.dek,
  );
  const messageIds: string[] = [];
  let parentId: string | null = null;
  texts.forEach((text, i) => {
    const mid = newId('msg');
    t.c.repos.messages.insert(
      {
        id: mid,
        conversationId: id,
        userId: owner.userId,
        parentId,
        role: i % 2 === 0 ? 'user' : 'assistant',
        status: 'complete',
        parts: [
          { type: 'reasoning', text: 'secret thought', durationMs: null },
          { type: 'text', text },
        ],
        providerId: null,
        modelId: null,
        createdAt: at + i,
      },
      owner.dek,
    );
    messageIds.push(mid);
    parentId = mid;
  });
  return { id, messageIds };
}

const deps = (now: () => number = () => 0) => ({
  conversations: t.c.repos.conversations,
  messages: t.c.repos.messages,
  now,
});

test('finds titles and message text, case and accent insensitive', () => {
  const a = seedChat('Resep Kopi', ['Aku suka kopi di café itu']);
  const r = searchConversations(deps(), auth, 'CAFE', {});
  expect(r.results).toHaveLength(1);
  expect(r.results[0]).toMatchObject({
    conversationId: a.id,
    messageId: a.messageIds[0],
    matchedIn: 'message',
  });
  expect(r.results[0]?.snippet).toContain('café');
  const byTitle = searchConversations(deps(), auth, 'resép', {});
  expect(byTitle.results[0]).toMatchObject({
    conversationId: a.id,
    messageId: null,
    matchedIn: 'title',
    title: 'Resep Kopi',
  });
  expect(r.partial).toBe(false);
  expect(r.nextCursor).toBeNull();
});

test('reasoning parts are not searched', () => {
  seedChat('x', ['hello']);
  expect(searchConversations(deps(), auth, 'secret', {}).results).toEqual([]);
});

test.each(['c++', '(x)', '**', 'a.b', '\\d'])('special characters are literal: %s', (needle) => {
  const hit = seedChat('plain', [`before ${needle} after`]);
  seedChat('plain', ['cc 1 axb xx 5 d aab']);
  const r = searchConversations(deps(), auth, needle, {});
  expect(r.results.map((x) => x.conversationId)).toEqual([hit.id]);
});

test('encrypted data stays per user', async () => {
  const other = await addUser(t, 'second');
  seedChat('theirs', ['needle of the other user'], other.auth);
  const mine = seedChat('mine', ['needle of mine']);
  const r = searchConversations(deps(), auth, 'needle', {});
  expect(r.results.map((x) => x.conversationId)).toEqual([mine.id]);
});

test('deleted conversations are skipped', () => {
  const gone = seedChat('gone', ['needle here']);
  const kept = seedChat('kept', ['needle there']);
  t.c.repos.conversations.softDelete(auth.userId, gone.id, BASE);
  const r = searchConversations(deps(), auth, 'needle', {});
  expect(r.results.map((x) => x.conversationId)).toEqual([kept.id]);
});

test('time budget returns partial results and continues without repeats or gaps', () => {
  const ids: string[] = [];
  for (let i = 0; i < 10; i++) ids.push(seedChat(`chat ${i}`, ['needle one', 'needle two']).id);
  let clock = 0;
  const messages = {
    ...t.c.repos.messages,
    iterateForConversation: function* (cid: string, dek: Buffer, offset?: number) {
      for (const m of t.c.repos.messages.iterateForConversation(cid, dek, offset)) {
        clock += 50;
        yield m;
      }
    },
  };
  const d = { conversations: t.c.repos.conversations, messages, now: () => clock };
  expect(SEARCH_BUDGET_MS).toBe(400);
  const first = searchConversations(d, auth, 'needle', {});
  expect(first.partial).toBe(true);
  expect(first.nextCursor).not.toBeNull();
  const all = [...first.results];
  let cursor = first.nextCursor;
  let guard = 0;
  while (cursor && guard++ < 20) {
    clock = 0;
    const r = searchConversations(d, auth, 'needle', { cursor });
    all.push(...r.results);
    cursor = r.nextCursor;
  }
  expect(cursor).toBeNull();
  const keys = all.map((x) => `${x.conversationId}:${x.messageId}`);
  expect(new Set(keys).size).toBe(keys.length);
  expect(keys).toHaveLength(20);
  expect(new Set(all.map((x) => x.conversationId))).toEqual(new Set(ids));
});

test('a long chat stops within the budget and later calls keep making progress', () => {
  const texts = Array.from({ length: 60 }, (_, i) => `needle ${i}`);
  const chat = seedChat('long', texts);
  let clock = 0;
  let decrypted = 0;
  const messages = {
    ...t.c.repos.messages,
    iterateForConversation: function* (cid: string, dek: Buffer, offset?: number) {
      for (const m of t.c.repos.messages.iterateForConversation(cid, dek, offset)) {
        clock += 100;
        decrypted++;
        yield m;
      }
    },
  };
  const d = { conversations: t.c.repos.conversations, messages, now: () => clock };
  const first = searchConversations(d, auth, 'needle', { limit: 50 });
  expect(first.partial).toBe(true);
  expect(decrypted).toBeLessThanOrEqual(5);
  const seen = [...first.results.map((r) => r.messageId)];
  let cursor = first.nextCursor;
  let calls = 1;
  while (cursor && calls < 40) {
    clock = 0;
    decrypted = 0;
    const r = searchConversations(d, auth, 'needle', { cursor, limit: 50 });
    expect(decrypted).toBeLessThanOrEqual(5);
    if (r.nextCursor) expect(r.results.length).toBeGreaterThan(1);
    seen.push(...r.results.map((x) => x.messageId));
    cursor = r.nextCursor;
    calls++;
  }
  expect(cursor).toBeNull();
  expect(seen).toEqual(chat.messageIds);
});

test('a query of only combining marks is refused', () => {
  expect(() => searchConversations(deps(), auth, '́́', {})).toThrow(/2 characters/);
});

test('the limit can stop mid-conversation and the cursor resumes exactly', () => {
  seedChat('a', ['needle 1', 'needle 2', 'needle 3', 'needle 4', 'needle 5']);
  seedChat('b', ['needle 6', 'needle 7']);
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 10; pages++) {
    const r = searchConversations(deps(), auth, 'needle', { cursor, limit: 2 });
    seen.push(...r.results.map((x) => x.snippet));
    if (!r.nextCursor) break;
    cursor = r.nextCursor;
  }
  expect(seen.sort()).toEqual(
    ['needle 1', 'needle 2', 'needle 3', 'needle 4', 'needle 5', 'needle 6', 'needle 7'].sort(),
  );
});

test('short queries are refused', async () => {
  const call = authed(t, cookie);
  expect((await call('/api/search?q=a')).status).toBe(400);
  expect((await call('/api/search?q=%20a%20')).status).toBe(400);
  expect((await call('/api/search?q=ab&cursor=%21%21')).status).toBe(400);
  seedChat('ab title', []);
  const ok = await call('/api/search?q=ab');
  expect(ok.status).toBe(200);
  expect(((await ok.json()) as { results: unknown[] }).results).toHaveLength(1);
});

test('the route needs a session', async () => {
  const res = await t.app.request('/api/search?q=ab', {
    headers: { origin: 'http://localhost:3420' },
  });
  expect(res.status).toBe(401);
});

test('foldText and makeSnippet', () => {
  expect(foldText('CAFÉ ﬁn')).toBe('cafe fin');
  const long = `${'x'.repeat(300)} needle ${'y'.repeat(300)}`;
  const s = makeSnippet(long, 301, 6);
  expect(s.length).toBeLessThanOrEqual(164);
  expect(s).toContain('needle');
  expect(makeSnippet('a\n\n  b needle', 7, 6)).toBe('a b needle');
});
