import { newId } from '@neotext/shared';
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  authContextFor,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';
import type { AuthContext } from '../http/env';

let t: TestApp;
let auth: AuthContext;
let convId: string;
beforeEach(async () => {
  t = await createTestApp();
  auth = authContextFor(t, (await setupOwner(t)).cookie);
  convId = t.c.conversations.create(auth, { title: 'c' }).id;
});
afterEach(async () => {
  await t.close();
});

function insert(status: 'complete' | 'streaming', secret = 'rahasia besar') {
  const id = newId('msg');
  t.c.repos.messages.insert(
    {
      id,
      conversationId: convId,
      userId: auth.userId,
      parentId: null,
      role: 'assistant',
      status,
      parts: [{ type: 'text', text: secret }],
      providerId: 'prv_1',
      modelId: 'm/1',
      createdAt: 1000,
    },
    auth.dek,
  );
  return id;
}

test('parts round trip and are sealed', () => {
  const id = insert('complete');
  const raw = t.c.db.raw.prepare('SELECT parts FROM messages WHERE id = ?').get(id) as {
    parts: Buffer;
  };
  expect(raw.parts.toString('utf8')).not.toContain('rahasia');
  t.c.repos.messages.update(
    id,
    {
      parts: [{ type: 'text', text: 'baru' }],
      finishReason: 'stop',
      errorCode: null,
      generationRef: 'gen_x',
      usage: {
        promptTokens: 1,
        completionTokens: 2,
        reasoningTokens: 0,
        cachedTokens: 0,
        costUsd: null,
        webSearchRequests: 0,
        ttftMs: 5,
        durationMs: 9,
        upstreamProvider: null,
      },
    },
    2000,
    auth.dek,
  );
  const m = t.c.repos.messages.get(id, auth.dek);
  expect(m?.parts).toEqual([{ type: 'text', text: 'baru' }]);
  expect(m?.userId).toBe(auth.userId);
  expect(m?.model).toEqual({ providerId: 'prv_1', modelId: 'm/1' });
  expect(m?.finishReason).toBe('stop');
  expect(m?.usage?.completionTokens).toBe(2);
  expect(m?.updatedAt).toBe(2000);
  expect(t.c.repos.messages.listForConversation(convId, auth.dek)).toHaveLength(1);
});

test('markInterrupted only touches streaming rows', () => {
  const streaming = insert('streaming');
  const done = insert('complete');
  expect(t.c.repos.messages.markInterrupted(5000)).toBe(1);
  const s = t.c.repos.messages.get(streaming, auth.dek);
  expect(s?.status).toBe('interrupted');
  expect(s?.parts).toEqual([{ type: 'text', text: 'rahasia besar' }]);
  expect(t.c.repos.messages.get(done, auth.dek)?.status).toBe('complete');
});
