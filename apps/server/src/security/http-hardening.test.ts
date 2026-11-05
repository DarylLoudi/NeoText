import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { authed, createTestApp, setupOwner, type TestApp } from '../../test-support/test-app';

let t: TestApp | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});
const start = async (env: Record<string, string> = {}) => {
  t = await createTestApp({ env });
  return t;
};

const login = (app: TestApp, username: string, forwardedFor?: string) =>
  app.app.request('/api/auth/login', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3420',
      'content-type': 'application/json',
      ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
    },
    body: JSON.stringify({ username, password: 'wrong password here' }),
  });

test('production cookie is __Host- and Secure; HSTS present', async () => {
  const app = await start({ NEOTEXT_PUBLIC_URL: 'https://chat.example.org' });
  const res = await app.app.request('/api/setup', {
    method: 'POST',
    headers: { origin: 'https://chat.example.org', 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'daryl',
      password: 'correct horse battery',
      mode: 'personal',
    }),
  });
  expect(res.status).toBe(201);
  const cookie = res.headers.get('set-cookie') ?? '';
  expect(cookie).toMatch(/^__Host-neotext_session=/);
  expect(cookie).toMatch(/; Secure/i);
  expect(cookie).toMatch(/; HttpOnly/i);
  expect(cookie).toMatch(/; SameSite=Strict/i);
  expect(cookie).toMatch(/; Path=\//i);
  expect(cookie).not.toMatch(/Domain=/i);
  expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000');
  const health = await app.app.request('/api/health');
  expect(health.headers.get('strict-transport-security')).toBe('max-age=31536000');
});

test('http deployment has no HSTS', async () => {
  const app = await start();
  const res = await app.app.request('/api/health');
  expect(res.headers.get('strict-transport-security')).toBeNull();
  const { cookie } = await setupOwner(app);
  expect(cookie).toMatch(/^neotext_session=/);
});

test('spoofed forwarded-for is ignored', async () => {
  const app = await start();
  await setupOwner(app);
  // Per username: a fresh made-up address on each try does not reset the count.
  const sameUser: number[] = [];
  for (let i = 0; i < 6; i++) sameUser.push((await login(app, 'daryl', `10.0.0.${i}`)).status);
  expect(sameUser).toEqual([401, 401, 401, 401, 401, 429]);
  // Per IP: different usernames and addresses still share the one real client address.
  app.clock.advance(61_000);
  const perIp: number[] = [];
  for (let i = 0; i < 11; i++) perIp.push((await login(app, `user${i}`, `10.1.0.${i}`)).status);
  expect(perIp.slice(0, 10).every((s) => s === 401)).toBe(true);
  expect(perIp[10]).toBe(429);
});

test('trusted proxy uses the first hop', async () => {
  const app = await start({ NEOTEXT_TRUST_PROXY: 'true' });
  await setupOwner(app);
  const codes: number[] = [];
  for (let i = 0; i < 11; i++) {
    codes.push((await login(app, `user${i}`, '203.0.113.7, 10.0.0.1')).status);
  }
  expect(codes[10]).toBe(429);
  // Another client behind the same proxy has its own allowance.
  expect((await login(app, 'someone', '198.51.100.2, 10.0.0.1')).status).toBe(401);
});

test('production errors reveal nothing', async () => {
  const app = await start({ NODE_ENV: 'production', NEOTEXT_LOG_LEVEL: 'silent' });
  app.app.get('/api/boom', () => {
    throw new Error('db at /srv/neotext/secret.db is locked');
  });
  const res = await app.app.request('/api/boom');
  expect(res.status).toBe(500);
  const text = await res.text();
  expect(text).not.toContain('secret.db');
  expect(text).not.toContain('stack');
  expect(text).not.toMatch(/at .*\.ts:\d+/);
  expect(JSON.parse(text)).toMatchObject({ error: { code: 'internal' } });
});

test('oversized bodies are refused', async () => {
  const app = await start();
  const { cookie } = await setupOwner(app);
  const res = await authed(app, cookie)('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({ patch: { pad: 'x'.repeat(2 * 1024 * 1024) } }),
  });
  expect(res.status).toBe(413);
  expect(await res.json()).toMatchObject({ error: { code: 'payload_too_large' } });
});

test('html responses carry the CSP', async () => {
  const dist = await fs.mkdtemp(path.join(os.tmpdir(), 'neotext-dist-'));
  try {
    await fs.writeFile(path.join(dist, 'index.html'), '<!doctype html><title>NeoText</title>');
    const app = await start({ NEOTEXT_WEB_DIST: dist });
    const res = await app.app.request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>NeoText</title>');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  } finally {
    await fs.rm(dist, { recursive: true, force: true });
  }
});

test('costly endpoints have their own per-user limits, below the general one', async () => {
  const app = await start();
  const { cookie } = await setupOwner(app);
  const as = authed(app, cookie);
  const searches: number[] = [];
  for (let i = 0; i < 61; i++) searches.push((await as('/api/search?q=halo')).status);
  expect(searches.slice(0, 60).every((s) => s === 200)).toBe(true);
  expect(searches[60]).toBe(429);
  // Other endpoints still answer: the general limit was not used up.
  expect((await as('/api/conversations')).status).toBe(200);

  const uploads: number[] = [];
  for (let i = 0; i < 61; i++) {
    const form = new FormData();
    form.append('file', new File(['halo'], 'a.txt', { type: 'text/plain' }));
    const res = await app.app.request('/api/attachments', {
      method: 'POST',
      body: form,
      headers: { cookie, origin: 'http://localhost:3420' },
    });
    uploads.push(res.status);
  }
  expect(uploads.slice(0, 60).every((s) => s === 201)).toBe(true);
  expect(uploads[60]).toBe(429);
});
