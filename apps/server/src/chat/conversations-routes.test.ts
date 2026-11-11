import type { ConversationSummary, Folder } from '@neotext/shared';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { authed, createTestApp, setupOwner, type TestApp } from '../../test-support/test-app';

let t: TestApp;
let api: ReturnType<typeof authed>;
beforeEach(async () => {
  t = await createTestApp();
  api = authed(t, (await setupOwner(t)).cookie);
});
afterEach(async () => {
  await t.close();
});

const body = (value: unknown) => ({ body: JSON.stringify(value) });

test('requires a session', async () => {
  expect((await t.app.request('/api/conversations')).status).toBe(401);
  expect((await t.app.request('/api/folders')).status).toBe(401);
});

test('conversation lifecycle over HTTP', async () => {
  const created = await api('/api/conversations', { method: 'POST', ...body({ title: 'Halo' }) });
  expect(created.status).toBe(201);
  const conv = (await created.json()) as ConversationSummary;
  expect(conv.title).toBe('Halo');

  const list = (await (await api('/api/conversations?limit=10')).json()) as {
    items: ConversationSummary[];
    nextCursor: string | null;
  };
  expect(list.items.map((i) => i.id)).toEqual([conv.id]);
  expect(list.nextCursor).toBeNull();

  const detail = (await (await api(`/api/conversations/${conv.id}`)).json()) as {
    conversation: ConversationSummary;
    messages: unknown[];
  };
  expect(detail.conversation.id).toBe(conv.id);
  expect(detail.messages).toEqual([]);

  const patched = await api(`/api/conversations/${conv.id}`, {
    method: 'PATCH',
    ...body({ archived: true }),
  });
  expect(((await patched.json()) as ConversationSummary).archived).toBe(true);

  expect((await api(`/api/conversations/${conv.id}`, { method: 'DELETE' })).status).toBe(204);
  expect((await api(`/api/conversations/${conv.id}`)).status).toBe(404);
  const restored = await api(`/api/conversations/${conv.id}/restore`, { method: 'POST' });
  expect(restored.status).toBe(200);
  expect(((await restored.json()) as ConversationSummary).deletedAt).toBeNull();
});

test('bad query and bad cursor are 400', async () => {
  expect((await api('/api/conversations?limit=1000')).status).toBe(400);
  const res = await api('/api/conversations?cursor=%25%25not-a-cursor');
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad_request');
  const odd = Buffer.from(JSON.stringify({ a: 1 })).toString('base64url');
  expect((await api(`/api/conversations?cursor=${odd}`)).status).toBe(400);
});

test('folder lifecycle over HTTP', async () => {
  const created = await api('/api/folders', {
    method: 'POST',
    ...body({ name: 'Kuliah', position: 'a0', color: '#112233' }),
  });
  expect(created.status).toBe(201);
  const folder = (await created.json()) as Folder;
  const list = (await (await api('/api/folders')).json()) as { folders: Folder[] };
  expect(list.folders.map((f) => f.name)).toEqual(['Kuliah']);
  const patched = await api(`/api/folders/${folder.id}`, {
    method: 'PATCH',
    ...body({ name: 'Kampus' }),
  });
  expect(((await patched.json()) as Folder).name).toBe('Kampus');
  expect((await api(`/api/folders/${folder.id}`, { method: 'DELETE' })).status).toBe(204);
  expect((await api(`/api/folders/${folder.id}`, { method: 'DELETE' })).status).toBe(404);
});

test('permanent delete and empty trash over HTTP', async () => {
  const make = async (title: string) =>
    (
      (await (
        await api('/api/conversations', { method: 'POST', ...body({ title }) })
      ).json()) as ConversationSummary
    ).id;
  const a = await make('a');
  const b = await make('b');
  expect((await api(`/api/conversations/${a}?permanent=1`, { method: 'DELETE' })).status).toBe(400);
  await api(`/api/conversations/${a}`, { method: 'DELETE' });
  await api(`/api/conversations/${b}`, { method: 'DELETE' });
  expect((await api(`/api/conversations/${a}?permanent=1`, { method: 'DELETE' })).status).toBe(204);
  const emptied = await api('/api/trash', { method: 'DELETE' });
  expect(emptied.status).toBe(200);
  expect(await emptied.json()).toEqual({ purged: 1, ids: [b] });
  expect((await t.app.request('/api/trash', { method: 'DELETE' })).status).toBe(401);
});
