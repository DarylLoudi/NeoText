import type { ProviderPublic, StreamEvent } from '@neotext/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { type MockProvider, startMockProvider } from '../../test-support/mock-provider';
import { readEvents } from '../../test-support/sse-client';
import { chunk, DONE, finish } from '../../test-support/sse-frames';
import {
  addUser,
  authed,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';
import { aad } from '../crypto/aad';
import { openText } from '../crypto/aead';

const KEY = 'sk-lab-test-0123456789abcdef';

let t: TestApp;
let mock: MockProvider;
let admin: ReturnType<typeof authed>;
let member: ReturnType<typeof authed>;
let memberAuth: Awaited<ReturnType<typeof addUser>>['auth'];

beforeEach(async () => {
  t = await createTestApp();
  mock = await startMockProvider();
  mock.models = ['m1'];
  admin = authed(t, (await setupOwner(t, { mode: 'community' })).cookie);
  const sinta = await addUser(t, 'sinta');
  member = authed(t, sinta.cookie);
  memberAuth = sinta.auth;
});
afterEach(async () => {
  await t.close();
  await mock.close();
});

const json = (value: unknown) => ({ body: JSON.stringify(value) });
const createShared = async (extra: Record<string, unknown> = {}) => {
  const res = await admin('/api/providers', {
    method: 'POST',
    ...json({
      kind: 'openai-compatible',
      name: 'Lab',
      baseUrl: mock.url,
      apiKey: KEY,
      headers: { 'X-Team': 'lab-secret-header' },
      shared: true,
      ...extra,
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { provider: ProviderPublic }).provider;
};
const chat = (as: typeof member, providerId: string) =>
  as('/api/chat', {
    method: 'POST',
    ...json({
      conversationId: null,
      parentId: null,
      userMessage: { text: 'Hai' },
      targets: [{ providerId, modelId: 'm1' }],
      options: {},
    }),
  });
const finished = (evs: StreamEvent[]) =>
  evs.find((e): e is Extract<StreamEvent, { type: 'generation.finished' }> => {
    return e.type === 'generation.finished';
  });

test('a member can chat through a shared provider without seeing the key', async () => {
  const p = await createShared();
  expect(p).toMatchObject({ shared: true, hasKey: true });
  expect(p.keyHint).not.toBeNull();

  const text = await (await member('/api/providers')).text();
  const { providers } = JSON.parse(text) as { providers: ProviderPublic[] };
  expect(providers).toHaveLength(1);
  expect(providers[0]).toMatchObject({ id: p.id, shared: true, hasKey: true, keyHint: null });
  expect(text).not.toContain(KEY);
  expect(text).not.toContain('lab-secret-header');

  const models = (await (await member('/api/models')).json()) as {
    providers: { providerId: string; models: { id: string }[] }[];
  };
  expect(models.providers.find((x) => x.providerId === p.id)?.models.map((m) => m.id)).toEqual([
    'm1',
  ]);

  mock.enqueue({ frames: [chunk({ content: 'Halo' }), finish('stop'), DONE] });
  const res = await chat(member, p.id);
  expect(res.status).toBe(200);
  expect(finished(await readEvents(res))?.message.status).toBe('complete');
  const call = mock.requests.filter((r) => r.path === '/v1/chat/completions').at(-1);
  expect(call?.headers.authorization).toBe(`Bearer ${KEY}`);
  expect(call?.headers['x-team']).toBe('lab-secret-header');
});

test('an admin still sees the key hint and address of a shared provider', async () => {
  const p = await createShared();
  const [row] = ((await (await admin('/api/providers')).json()) as { providers: ProviderPublic[] })
    .providers;
  expect(row?.id).toBe(p.id);
  expect(row?.keyHint).toMatch(/^sk-lab-t…/);
  expect(row?.baseUrl).toBe(mock.url);
});

test('a member never gets the address or headers of a shared provider', async () => {
  const p = await createShared();
  const text = await (await member('/api/providers')).text();
  const row = (JSON.parse(text) as { providers: Record<string, unknown>[] }).providers[0];
  expect(row).toMatchObject({ id: p.id, shared: true, baseUrl: '', keyHint: null });
  expect(row).not.toHaveProperty('headers');
  expect(text).not.toContain(mock.url);
  expect(text).not.toContain(new URL(mock.url).host);
});

test('a member does not learn the address of a shared provider from its errors', async () => {
  // Nothing listens on port 9, so the model list fails for everyone.
  const p = await createShared({ baseUrl: 'http://127.0.0.1:9' });
  const text = await (await member('/api/models')).text();
  expect(text).toContain(p.id);
  expect(text).toContain('"error":"');
  expect(text).not.toContain('127.0.0.1');
});

test('a member gets a fixed text for shared provider errors; the admin the real one', async () => {
  const p = await createShared();
  const upstream = JSON.stringify({ error: { message: 'proxy gw.corp.internal:8443 refused' } });
  const lastError = (evs: StreamEvent[]) =>
    JSON.stringify(finished(evs)?.message.parts.filter((x) => x.type === 'error'));
  const warn = vi.spyOn(t.c.log, 'warn');

  mock.enqueue({ status: 400, body: upstream });
  const memberText = lastError(await readEvents(await chat(member, p.id)));
  expect(memberText).toContain('bad_request');
  expect(memberText).toContain('The shared provider could not handle this request');
  expect(memberText).not.toContain('gw.corp.internal');
  // The real text stays in the server log, under the provider's id.
  expect(JSON.stringify(warn.mock.calls)).toContain('gw.corp.internal');
  expect(JSON.stringify(warn.mock.calls)).toContain(p.id);

  mock.enqueue({ status: 400, body: upstream });
  expect(lastError(await readEvents(await chat(admin, p.id)))).toContain('gw.corp.internal');

  mock.modelsStatus = 402;
  mock.modelsBody = JSON.stringify({ error: { message: 'billing at gw.corp.internal' } });
  const models = await (await member(`/api/providers/${p.id}/models?refresh=1`)).text();
  expect(models).toContain('out of credits');
  expect(models).not.toContain('gw.corp.internal');
  const own = await (await admin(`/api/providers/${p.id}/models?refresh=1`)).text();
  expect(own).toContain('billing at gw.corp.internal');
});

test('members cannot create, edit, test or delete shared providers', async () => {
  const create = await member('/api/providers', {
    method: 'POST',
    ...json({ kind: 'openai-compatible', name: 'Mine', baseUrl: mock.url, shared: true }),
  });
  expect(create.status).toBe(403);
  expect(((await create.json()) as { error: { code: string } }).error.code).toBe('forbidden');
  expect(t.c.providers.list(memberAuth)).toEqual([]);

  const p = await createShared();
  const patch = await member(`/api/providers/${p.id}`, { method: 'PATCH', ...json({ name: 'x' }) });
  expect(patch.status).toBe(403);
  expect((await member(`/api/providers/${p.id}`, { method: 'DELETE' })).status).toBe(403);
  expect((await member(`/api/providers/${p.id}/test`, { method: 'POST' })).status).toBe(403);
  // The refused calls changed nothing, and the admin can still edit, test and delete.
  const edit = await admin(`/api/providers/${p.id}`, {
    method: 'PATCH',
    ...json({ name: 'Lab 2' }),
  });
  expect(edit.status).toBe(200);
  expect((await admin(`/api/providers/${p.id}/test`, { method: 'POST' })).status).toBe(200);
  expect((await admin(`/api/providers/${p.id}`, { method: 'DELETE' })).status).toBe(204);
});

test('a shared endpoint cannot carry a login in its url', async () => {
  const res = await admin('/api/providers', {
    method: 'POST',
    ...json({
      kind: 'openai-compatible',
      name: 'Lab',
      baseUrl: `http://user:pass@127.0.0.1:${new URL(mock.url).port}`,
      shared: true,
    }),
  });
  expect(res.status).toBe(400);
  expect(t.c.providers.list(memberAuth)).toEqual([]);
});

test('shared keys are sealed with the instance key', async () => {
  const p = await createShared();
  const row = t.c.db.raw
    .prepare('select owner_user_id as owner, api_key as k from providers where id = ?')
    .get(p.id) as { owner: string | null; k: Buffer };
  expect(row.owner).toBeNull();
  expect(openText(t.c.instanceKey, row.k, aad('providers', 'api_key', p.id))).toBe(KEY);
  expect(() => openText(memberAuth.dek, row.k, aad('providers', 'api_key', p.id))).toThrow();
  expect(() =>
    openText(t.c.instanceKey, row.k, aad('providers', 'api_key', 'prv_other')),
  ).toThrow();
  // The instance key alone opens it, whoever asks.
  const resolved = t.c.providers.resolve(memberAuth, p.id);
  expect(resolved.apiKey).toBe(KEY);
  expect(resolved.headers).toEqual({ 'X-Team': 'lab-secret-header' });
});

test('updating a shared provider reseals its key with the instance key', async () => {
  const p = await createShared();
  await admin(`/api/providers/${p.id}`, {
    method: 'PATCH',
    ...json({ apiKey: 'sk-new-0123456789abcdef', headers: { A: 'b' } }),
  });
  expect(t.c.providers.resolve(memberAuth, p.id)).toMatchObject({
    apiKey: 'sk-new-0123456789abcdef',
    headers: { A: 'b' },
  });
});

test('deleting a shared provider keeps old messages readable', async () => {
  const p = await createShared();
  mock.enqueue({ frames: [chunk({ content: 'Halo' }), finish('stop'), DONE] });
  const events = await readEvents(await chat(member, p.id));
  expect(finished(events)?.message.status).toBe('complete');
  const started = events.find((e) => e.type === 'generation.started');
  const conversationId = started?.type === 'generation.started' ? started.conversationId : null;
  expect(conversationId).toBeTruthy();

  expect((await admin(`/api/providers/${p.id}`, { method: 'DELETE' })).status).toBe(204);
  expect(t.c.providers.list(memberAuth)).toEqual([]);

  const res = await member(`/api/conversations/${conversationId}`);
  expect(res.status).toBe(200);
  const body = JSON.stringify(await res.json());
  expect(body).toContain('Halo');
  expect(body).toContain('Hai');
});
