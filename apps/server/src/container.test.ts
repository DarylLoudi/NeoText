import { newId } from '@neotext/shared';
import { expect, test } from 'vitest';
import { authContextFor, createTestApp, setupOwner } from '../test-support/test-app';
import { createGeneration } from './chat/generation/generation';

test('a streaming row left from a previous run becomes interrupted at startup', async () => {
  const first = await createTestApp();
  const auth = authContextFor(first, (await setupOwner(first)).cookie);
  const convId = first.c.conversations.create(auth, { title: 'c' }).id;
  const insert = (status: 'streaming' | 'complete') => {
    const id = newId('msg');
    first.c.repos.messages.insert(
      {
        id,
        conversationId: convId,
        userId: auth.userId,
        parentId: null,
        role: 'assistant',
        status,
        parts: [{ type: 'text', text: 'half' }],
        providerId: 'prv_1',
        modelId: 'm/1',
        createdAt: 1000,
      },
      auth.dek,
    );
    return id;
  };
  const streamingId = insert('streaming');
  const completeId = insert('complete');
  await first.close({ keepData: true });

  const second = await createTestApp({ dataDir: first.dataDir });
  try {
    const status = (id: string) =>
      (
        second.c.db.raw.prepare('SELECT status FROM messages WHERE id = ?').get(id) as {
          status: string;
        }
      ).status;
    expect(status(streamingId)).toBe('interrupted');
    expect(status(completeId)).toBe('complete');
  } finally {
    await second.close();
  }
});

test('close aborts running generations before the database closes', async () => {
  const t = await createTestApp();
  const model = { providerId: 'prv_1', modelId: 'm/1' };
  const g = createGeneration({
    id: 'gen_1',
    userId: 'usr_a',
    conversationId: 'cnv_1',
    message: {
      id: 'msg_1',
      conversationId: 'cnv_1',
      parentId: null,
      role: 'assistant',
      status: 'streaming',
      parts: [],
      model,
      usage: null,
      finishReason: null,
      createdAt: 1,
      updatedAt: 1,
    },
    model,
    startedAt: 1,
    log: t.c.log,
  });
  let dbOpenAtFinish = false;
  t.c.generations.start(g, async (x) => {
    await new Promise<void>((resolve) => x.signal.addEventListener('abort', () => resolve()));
    dbOpenAtFinish = t.c.db.raw.open;
    x.finish({ ...x.snapshot(), status: 'aborted' });
  });
  await new Promise((r) => setImmediate(r));
  await t.close();
  expect(g.abortReason()).toBe('shutdown');
  expect(dbOpenAtFinish).toBe(true);
  expect(t.c.db.raw.open).toBe(false);
});
