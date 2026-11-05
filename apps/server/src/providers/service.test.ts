import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { type MockProvider, startMockProvider } from '../../test-support/mock-provider';
import {
  addUser,
  authContextFor,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';
import { aad } from '../crypto/aad';
import { sealText } from '../crypto/aead';
import { MODEL_CACHE_TTL_MS } from './model-cache';
import { createProviderService } from './service';

const FAKE_KEY = 'sk-or-v1-test0000111122223333444455556666';
const ENV_KEY = 'sk-or-v1-test-key-0000000000';

let t: TestApp;
let mock: MockProvider;
let auth: ReturnType<typeof authContextFor>;
beforeEach(async () => {
  t = await createTestApp();
  mock = await startMockProvider();
  const owner = await setupOwner(t);
  auth = authContextFor(t, owner.cookie);
});
afterEach(async () => {
  await mock.close();
  await t.close();
});

const compat = (name = 'Local') => ({
  kind: 'openai-compatible' as const,
  name,
  baseUrl: mock.url,
});
const modelRequests = () => mock.requests.filter((r) => r.path === '/v1/models').length;

test('keys never leave the server', async () => {
  const p = await t.c.providers.create(auth, {
    kind: 'openrouter',
    name: 'OpenRouter',
    apiKey: FAKE_KEY,
  });
  expect(p).toMatchObject({ hasKey: true, keyHint: 'sk-or-v1…6666', shared: false });
  expect(JSON.stringify(t.c.providers.list(auth))).not.toContain('test0000');
  const raw = t.c.db.raw.prepare('select api_key from providers where id = ?').get(p.id) as {
    api_key: Buffer;
  };
  expect(raw.api_key.includes(Buffer.from('test0000'))).toBe(false);
  expect(t.c.providers.resolve(auth, p.id).apiKey).toBe(FAKE_KEY);
});

test('short keys show only the last four characters', async () => {
  const p = await t.c.providers.create(auth, { ...compat(), apiKey: 'abcdefgh1234' });
  expect(p.keyHint).toBe('…1234');
});

test('other users cannot see or use a provider', async () => {
  const p = await t.c.providers.create(auth, compat());
  const sinta = await addUser(t, 'sinta');
  expect(t.c.providers.list(sinta.auth)).toEqual([]);
  expect(() => t.c.providers.resolve(sinta.auth, p.id)).toThrow(
    expect.objectContaining({ code: 'not_found', status: 404 }),
  );
  await expect(t.c.providers.update(sinta.auth, p.id, { name: 'x' })).rejects.toMatchObject({
    status: 404,
  });
  expect(() => t.c.providers.remove(sinta.auth, p.id)).toThrow(
    expect.objectContaining({ status: 404 }),
  );
});

test('shared providers are visible to members, resolved with the instance key', async () => {
  t.c.db.raw
    .prepare(
      `insert into providers (id, owner_user_id, category, kind, name, base_url, api_key, key_hint, enabled, position, created_at, updated_at)
       values ('prv_shared', null, 'llm', 'openai-compatible', 'Lab', ?, ?, 'sk-lab…cret', 1, 'a', 1, 1)`,
    )
    .run(
      mock.url,
      sealText(t.c.instanceKey, 'sk-lab-secret', aad('providers', 'api_key', 'prv_shared')),
    );
  const sinta = await addUser(t, 'sinta');
  const [shared] = t.c.providers.list(sinta.auth);
  expect(shared).toMatchObject({ id: 'prv_shared', shared: true, hasKey: true });
  expect(JSON.stringify(shared)).not.toContain('sk-lab-secret');
  expect(t.c.providers.resolve(sinta.auth, 'prv_shared').apiKey).toBe('sk-lab-secret');
  await expect(t.c.providers.update(sinta.auth, 'prv_shared', { name: 'x' })).rejects.toMatchObject(
    { status: 403 },
  );
});

test('custom endpoints need a base url', async () => {
  await expect(
    t.c.providers.create(auth, { kind: 'openai-compatible', name: 'X' }),
  ).rejects.toMatchObject({ code: 'bad_request' });
});

describe('private endpoints', () => {
  test('a personal instance allows its owner, not a member left from community mode', async () => {
    const p = await t.c.providers.create(auth, compat());
    expect(p.baseUrl).toBe(mock.url);
    expect(t.c.providers.resolve(auth, p.id).http).toBe(t.c.http.endpointsPrivate);
    const sinta = await addUser(t, 'sinta');
    await expect(t.c.providers.create(sinta.auth, compat())).rejects.toMatchObject({
      code: 'bad_request',
    });
  });

  test('a community refuses members and allows the admin', async () => {
    t.c.instance.set('mode', 'community');
    const sinta = await addUser(t, 'sinta');
    await expect(t.c.providers.create(sinta.auth, compat())).rejects.toMatchObject({
      code: 'bad_request',
      message: 'This address is on a private network. Only the admin can add endpoints like that.',
    });
    const p = await t.c.providers.create(auth, compat());
    expect(t.c.providers.resolve(auth, p.id).http).toBe(t.c.http.endpointsPrivate);
  });
});

test('model cache: fresh, stale-while-revalidate, refresh', async () => {
  const p = await t.c.providers.create(auth, compat());
  mock.models = ['a'];
  expect((await t.c.providers.models(auth, p.id)).models.map((m) => m.id)).toEqual(['a']);
  expect(modelRequests()).toBe(1);
  await t.c.providers.models(auth, p.id);
  expect(modelRequests()).toBe(1);

  mock.models = ['a', 'b'];
  t.clock.advance(MODEL_CACHE_TTL_MS + 1);
  const stale = await t.c.providers.models(auth, p.id);
  expect(stale).toMatchObject({ stale: true, error: null });
  expect(stale.models.map((m) => m.id)).toEqual(['a']);
  await t.c.providers.models(auth, p.id); // while refreshing: still a single refresh
  await t.c.providers.flushBackground();
  expect(modelRequests()).toBe(2);
  const fresh = await t.c.providers.models(auth, p.id);
  expect(fresh.stale).toBe(false);
  expect(fresh.models.map((m) => m.id)).toEqual(['a', 'b']);
  expect(t.c.providers.cachedModel(p.id, 'b')?.id).toBe('b');
  expect(t.c.providers.cachedModel(p.id, 'zzz')).toBeNull();

  mock.models = ['c'];
  const forced = await t.c.providers.models(auth, p.id, { refresh: true });
  expect(forced.models.map((m) => m.id)).toEqual(['c']);
  expect(modelRequests()).toBe(3);
});

test('a failed refresh keeps the cached models and reports the error', async () => {
  const p = await t.c.providers.create(auth, compat());
  mock.models = ['a'];
  await t.c.providers.models(auth, p.id);
  mock.modelsBody = '{"error":';
  const res = await t.c.providers.models(auth, p.id, { refresh: true });
  expect(res.models.map((m) => m.id)).toEqual(['a']);
  expect(res.stale).toBe(true);
  expect(res.error).toEqual(expect.any(String));
});

test('a failing background refresh settles quietly', async () => {
  const p = await t.c.providers.create(auth, compat());
  mock.models = ['a'];
  await t.c.providers.models(auth, p.id);
  mock.modelsBody = '{"error":';
  t.clock.advance(MODEL_CACHE_TTL_MS + 1);
  await t.c.providers.models(auth, p.id);
  await expect(t.c.providers.flushBackground()).resolves.toBeUndefined();
});

test('test() reports bad keys', async () => {
  const p = await t.c.providers.create(auth, {
    kind: 'openrouter',
    name: 'OpenRouter',
    baseUrl: mock.url,
    apiKey: FAKE_KEY,
  });
  expect(await t.c.providers.test(auth, p.id)).toMatchObject({ ok: true });
  mock.keyStatus = 401;
  expect(await t.c.providers.test(auth, p.id)).toMatchObject({ ok: false, code: 'auth' });
});

test('test() gives up on an endpoint that never answers', async () => {
  const sockets = new Set<import('node:net').Socket>();
  const hang = http.createServer(() => {});
  hang.on('connection', (s) => sockets.add(s));
  await new Promise<void>((r) => hang.listen(0, '127.0.0.1', r));
  try {
    const port = (hang.address() as AddressInfo).port;
    const svc = createProviderService({
      db: t.c.db,
      clock: t.c.clock,
      log: t.c.log,
      config: t.c.config,
      instanceKey: t.c.instanceKey,
      http: t.c.http,
      testTimeoutMs: 200,
    });
    const p = await svc.create(auth, { ...compat(), baseUrl: `http://127.0.0.1:${port}/v1` });
    const started = Date.now();
    expect(await svc.test(auth, p.id)).toMatchObject({ ok: false, code: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2000);
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise<void>((r) => hang.close(() => r()));
  }
});

test('warm runs at most once a minute and never throws', async () => {
  const p = await t.c.providers.create(auth, compat());
  t.c.providers.warm(auth, p.id);
  await t.c.providers.flushBackground();
  expect(modelRequests()).toBe(1);
  t.c.providers.warm(auth, p.id);
  await t.c.providers.flushBackground();
  expect(modelRequests()).toBe(1);
  t.clock.advance(61_000);
  t.c.providers.warm(auth, p.id);
  await t.c.providers.flushBackground();
  expect(modelRequests()).toBe(2);
  expect(() => t.c.providers.warm(auth, 'prv_missing')).not.toThrow();
});

test('flushBackground waits for a warm that is still in flight', async () => {
  const p = await t.c.providers.create(auth, compat());
  t.c.providers.warm(auth, p.id);
  expect(modelRequests()).toBe(0);
  await t.c.providers.flushBackground();
  expect(modelRequests()).toBe(1);
});

test('removing a key', async () => {
  const p = await t.c.providers.create(auth, { ...compat(), apiKey: FAKE_KEY });
  const updated = await t.c.providers.update(auth, p.id, { apiKey: null });
  expect(updated).toMatchObject({ hasKey: false, keyHint: null });
  expect(t.c.providers.resolve(auth, p.id).apiKey).toBeNull();
});

test('changing the endpoint drops the cached models', async () => {
  const p = await t.c.providers.create(auth, { ...compat(), apiKey: 'first-key-1234567890' });
  mock.models = ['old'];
  expect((await t.c.providers.models(auth, p.id)).error).toBeNull();
  expect(t.c.providers.cachedModel(p.id, 'old')).not.toBeNull();
  await t.c.providers.update(auth, p.id, { apiKey: 'second-key-1234567890' });
  expect(t.c.providers.cachedModel(p.id, 'old')).toBeNull();
  mock.models = ['new'];
  expect((await t.c.providers.models(auth, p.id)).error).toBeNull();
  await t.c.providers.update(auth, p.id, { headers: { 'x-a': 'b' } });
  expect(t.c.providers.cachedModel(p.id, 'new')).toBeNull();
  expect((await t.c.providers.models(auth, p.id)).error).toBeNull();
  await t.c.providers.update(auth, p.id, { baseUrl: mock.url });
  expect(t.c.providers.cachedModel(p.id, 'new')).toBeNull();
  expect((await t.c.providers.models(auth, p.id)).error).toBeNull();
  await t.c.providers.update(auth, p.id, { name: 'Renamed' });
  expect(t.c.providers.cachedModel(p.id, 'new')).not.toBeNull();
});

test('a fetch started before an endpoint change cannot write the cache afterwards', async () => {
  let release = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const slow = http.createServer((_req, res) => {
    void gate.then(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'slow-model' }] }));
    });
  });
  await new Promise<void>((r) => slow.listen(0, '127.0.0.1', r));
  try {
    const slowUrl = `http://127.0.0.1:${(slow.address() as AddressInfo).port}/v1`;
    const p = await t.c.providers.create(auth, { ...compat(), baseUrl: slowUrl });
    const pending = t.c.providers.models(auth, p.id);
    await new Promise((r) => setTimeout(r, 50));
    await t.c.providers.update(auth, p.id, { baseUrl: mock.url });
    release();
    await pending;
    expect(t.c.providers.cachedModel(p.id, 'slow-model')).toBeNull();
    mock.models = ['fresh'];
    const res = await t.c.providers.models(auth, p.id);
    expect(res.models.map((m) => m.id)).toEqual(['fresh']);
  } finally {
    release();
    slow.closeAllConnections();
    await new Promise<void>((r) => slow.close(() => r()));
  }
});

test('metadata addresses are refused even where private networks are allowed', async () => {
  await expect(
    t.c.providers.create(auth, {
      kind: 'openai-compatible',
      name: 'Meta',
      baseUrl: 'http://169.254.169.254/v1',
    }),
  ).rejects.toMatchObject({
    code: 'bad_request',
    message: "This address is reserved for cloud metadata and can't be used as an endpoint.",
  });
  const p = await t.c.providers.create(auth, compat());
  await expect(
    t.c.providers.update(auth, p.id, { baseUrl: 'http://169.254.169.254/v1' }),
  ).rejects.toMatchObject({ code: 'bad_request' });
});

describe('host lookups at save time', () => {
  const failing = ((_h: string, _o: unknown, cb: (e: Error | null) => void) =>
    cb(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }))) as never;
  const hanging = (() => {}) as never;
  const body = {
    kind: 'openai-compatible' as const,
    name: 'Far',
    baseUrl: 'http://nohost.invalid/v1',
  };
  const withLookup = (lookup: never) =>
    createProviderService({
      db: t.c.db,
      clock: t.c.clock,
      log: t.c.log,
      config: t.c.config,
      instanceKey: t.c.instanceKey,
      http: t.c.http,
      lookup,
    });

  test('an unresolvable host still saves where private networks are allowed', async () => {
    const p = await withLookup(failing).create(auth, body);
    expect(p.baseUrl).toBe(body.baseUrl);
  });

  test('a community member gets a clear error for an unresolvable host', async () => {
    t.c.instance.set('mode', 'community');
    const sinta = await addUser(t, 'sinta');
    await expect(withLookup(failing).create(sinta.auth, body)).rejects.toMatchObject({
      code: 'bad_request',
      status: 400,
      message: "Couldn't find that host. Check the address and your connection.",
    });
  });

  test('a slow lookup gives up after about three seconds', async () => {
    const started = Date.now();
    await withLookup(hanging).create(auth, body);
    expect(Date.now() - started).toBeLessThan(4500);
    t.c.instance.set('mode', 'community');
    const sinta = await addUser(t, 'sinta');
    await expect(withLookup(hanging).create(sinta.auth, body)).rejects.toMatchObject({
      status: 400,
    });
  });
});

test('one provider that cannot be opened does not fail the model list', async () => {
  mock.models = ['m1'];
  const good = await t.c.providers.create(auth, compat('Good'));
  const bad = await t.c.providers.create(auth, { ...compat('Bad'), apiKey: 'bad-key-1234567890' });
  t.c.db.raw.prepare('update providers set api_key = ? where id = ?').run(Buffer.alloc(40), bad.id);
  const { providers } = await t.c.providers.allModels(auth);
  expect(providers).toHaveLength(2);
  const byId = Object.fromEntries(providers.map((x) => [x.providerId, x]));
  expect(byId[good.id]?.models.map((m) => m.id)).toEqual(['m1']);
  expect(byId[bad.id]?.models).toEqual([]);
  expect(byId[bad.id]?.error).toEqual(expect.any(String));
});

describe('setup with a server OpenRouter key', () => {
  const setup = (useEnvProvider: boolean) =>
    t.app.request('/api/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3420' },
      body: JSON.stringify({
        username: 'daryl',
        password: 'correct horse battery',
        mode: 'personal',
        useEnvProvider,
      }),
    });

  beforeEach(async () => {
    await t.close();
    t = await createTestApp({ env: { OPENROUTER_API_KEY: ENV_KEY } });
  });

  test('can be adopted', async () => {
    expect(t.c.auth.instanceInfo().envProviderAvailable).toBe(true);
    const res = await setup(true);
    expect(res.status).toBe(201);
    const owner = authContextFor(t, (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '');
    const list = t.c.providers.list(owner);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'openrouter', name: 'OpenRouter', hasKey: true });
    expect(t.c.providers.resolve(owner, list[0]?.id ?? '').apiKey).toBe(ENV_KEY);
  });

  test('still succeeds when adopting the key fails', async () => {
    vi.spyOn(t.c.providers, 'createFromEnv').mockRejectedValue(new Error('boom'));
    const res = await setup(true);
    expect(res.status).toBe(201);
    const owner = authContextFor(t, (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '');
    expect(t.c.providers.list(owner)).toEqual([]);
  });

  test('is skipped when the owner declines', async () => {
    const res = await setup(false);
    expect(res.status).toBe(201);
    const owner = authContextFor(t, (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '');
    expect(t.c.providers.list(owner)).toEqual([]);
  });
});

describe('search providers', () => {
  let searchHits: { url: string; headers: http.IncomingHttpHeaders }[];
  let searchStatus: number;
  let searchServer: http.Server;
  let searchUrl: string;
  beforeEach(async () => {
    searchHits = [];
    searchStatus = 200;
    searchServer = http.createServer((req, res) => {
      searchHits.push({ url: req.url ?? '', headers: req.headers });
      res.writeHead(searchStatus, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          results: [
            { url: 'https://a.example/', title: 'A', content: 'a' },
            { url: 'https://b.example/', title: 'B', content: 'b' },
          ],
        }),
      );
    });
    await new Promise<void>((r) => searchServer.listen(0, '127.0.0.1', r));
    searchUrl = `http://127.0.0.1:${(searchServer.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    searchServer.closeAllConnections();
    await new Promise((r) => searchServer.close(r));
  });

  test('required fields, test connection, not in models', async () => {
    const s = await t.c.providers.create(auth, {
      kind: 'searxng',
      name: 'My SearXNG',
      baseUrl: searchUrl,
    });
    expect(s).toMatchObject({ category: 'search', kind: 'searxng', hasKey: false });
    const b = await t.c.providers.create(auth, {
      kind: 'brave',
      name: 'Brave',
      apiKey: FAKE_KEY,
      baseUrl: searchUrl,
    });
    expect(b).toMatchObject({ category: 'search', kind: 'brave', hasKey: true });
    const noBase = await t.c.providers.create(auth, {
      kind: 'tavily',
      name: 'Tavily',
      apiKey: FAKE_KEY,
    });
    expect(noBase.baseUrl).toBe('https://api.tavily.com');
    await expect(t.c.providers.create(auth, { kind: 'searxng', name: 'x' })).rejects.toMatchObject({
      status: 400,
    });

    // The connection test runs a one-result search for "neotext".
    expect(await t.c.providers.test(auth, s.id)).toMatchObject({ ok: true, modelCount: null });
    expect(searchHits[0]?.url).toBe('/search?q=neotext&format=json');
    expect(await t.c.providers.test(auth, b.id)).toMatchObject({ ok: true });
    expect(searchHits[1]?.url).toBe('/res/v1/web/search?q=neotext&count=1');
    expect(searchHits[1]?.headers['x-subscription-token']).toBe(FAKE_KEY);
    searchStatus = 401;
    expect(await t.c.providers.test(auth, s.id)).toMatchObject({ ok: false, code: 'auth' });
    searchStatus = 429;
    expect(await t.c.providers.test(auth, s.id)).toMatchObject({ ok: false, code: 'rate_limit' });

    const ids = (await t.c.providers.allModels(auth)).providers.map((p) => p.providerId);
    expect(ids).not.toContain(s.id);
    expect(ids).not.toContain(b.id);
  });
});
