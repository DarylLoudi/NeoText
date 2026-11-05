import { afterEach, beforeEach, expect, test } from 'vitest';
import { type MockProvider, startMockProvider } from '../../test-support/mock-provider';
import { authed, createTestApp, setupOwner, type TestApp } from '../../test-support/test-app';

let t: TestApp;
let mock: MockProvider;
let api: ReturnType<typeof authed>;
beforeEach(async () => {
  t = await createTestApp();
  mock = await startMockProvider();
  api = authed(t, (await setupOwner(t)).cookie);
});
afterEach(async () => {
  await mock.close();
  await t.close();
});

const body = (value: unknown) => ({ body: JSON.stringify(value) });

test('CRUD over HTTP', async () => {
  const created = await api('/api/providers', {
    method: 'POST',
    ...body({
      kind: 'openai-compatible',
      name: 'Local',
      baseUrl: mock.url,
      apiKey: 'secret-key-1234567890',
    }),
  });
  expect(created.status).toBe(201);
  const { provider } = (await created.json()) as { provider: { id: string } };
  expect(JSON.stringify(provider)).not.toContain('secret-key');

  const list = (await (await api('/api/providers')).json()) as { providers: { name: string }[] };
  expect(list.providers.map((p) => p.name)).toEqual(['Local']);

  const patched = await api(`/api/providers/${provider.id}`, {
    method: 'PATCH',
    ...body({ name: 'Renamed' }),
  });
  expect(((await patched.json()) as { provider: { name: string } }).provider.name).toBe('Renamed');

  expect((await api(`/api/providers/${provider.id}`, { method: 'DELETE' })).status).toBe(204);
  const after = (await (await api('/api/providers')).json()) as { providers: unknown[] };
  expect(after.providers).toEqual([]);
  expect((await api(`/api/providers/${provider.id}`, { method: 'DELETE' })).status).toBe(404);
});

test('GET /api/models groups by provider', async () => {
  mock.models = ['m1', 'm2'];
  await api('/api/providers', {
    method: 'POST',
    ...body({ kind: 'openai-compatible', name: 'Local', baseUrl: mock.url }),
  });
  const res = await api('/api/models');
  const json = (await res.json()) as {
    providers: { providerName: string; models: { id: string }[]; stale: boolean }[];
  };
  expect(json.providers).toHaveLength(1);
  expect(json.providers[0]?.providerName).toBe('Local');
  expect(json.providers[0]?.models.map((m) => m.id)).toEqual(['m1', 'm2']);
});

test('per-provider models, test and warm endpoints', async () => {
  mock.models = ['m1'];
  const created = await api('/api/providers', {
    method: 'POST',
    ...body({ kind: 'openai-compatible', name: 'Local', baseUrl: mock.url }),
  });
  const { provider } = (await created.json()) as { provider: { id: string } };
  const models = await api(`/api/providers/${provider.id}/models?refresh=1`);
  expect(((await models.json()) as { models: unknown[] }).models).toHaveLength(1);
  const test = await api(`/api/providers/${provider.id}/test`, { method: 'POST' });
  expect(await test.json()).toMatchObject({ ok: true });
  expect((await api(`/api/providers/${provider.id}/warm`, { method: 'POST' })).status).toBe(204);
  // Warm is fire-and-forget; let it finish so no request is still in flight at teardown.
  await t.c.providers.flushBackground();
});

test('presets are public to signed-in users', async () => {
  const res = await api('/api/provider-presets');
  const { presets } = (await res.json()) as { presets: { id: string; keyRequired: boolean }[] };
  expect(presets.find((p) => p.id === 'ollama')?.keyRequired).toBe(false);
  expect(presets.map((p) => p.id)).toContain('openrouter');
  expect((await t.app.request('/api/provider-presets')).status).toBe(401);
  expect((await t.app.request('/api/providers')).status).toBe(401);
});
