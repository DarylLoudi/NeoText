import type { Hono } from 'hono';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { addUser, createTestApp, setupOwner, type TestApp } from '../../test-support/test-app';
import type { AppEnv } from '../http/env';

/** The only API routes a request without a session may reach. */
const PUBLIC_ROUTES = new Set([
  'GET /api/health',
  'GET /api/instance',
  'POST /api/setup',
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'POST /api/auth/register',
  'POST /api/auth/recover',
]);

const jsonHeaders = { origin: 'http://localhost:3420', 'content-type': 'application/json' };

/** Every API endpoint the app serves, from its router, with path params filled in. */
function apiRoutes(app: Hono<AppEnv>): { method: string; key: string; path: string }[] {
  const seen = new Map<string, { method: string; key: string; path: string }>();
  for (const r of app.routes) {
    // `ALL` entries are middleware (`use`); no endpoint is registered for every method.
    if (r.method === 'ALL' || !r.path.startsWith('/api/')) continue;
    const key = `${r.method} ${r.path}`;
    const path = r.path.replace(/:[A-Za-z]+/g, 'x_fake0000');
    seen.set(key, { method: r.method, key, path });
  }
  return [...seen.values()];
}

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

test('the inventory sees the whole API, and every public route still exists', () => {
  const keys = apiRoutes(t.app).map((r) => r.key);
  // A broken walk would pass the checks below vacuously.
  expect(keys.length).toBeGreaterThan(70);
  for (const route of PUBLIC_ROUTES) expect(keys).toContain(route);
});

test('every route requires a session unless allowlisted', async () => {
  await setupOwner(t);
  const open: string[] = [];
  for (const r of apiRoutes(t.app)) {
    if (PUBLIC_ROUTES.has(r.key)) continue;
    const body = r.method === 'GET' || r.method === 'HEAD' ? undefined : '{}';
    const res = await t.app.request(r.path, { method: r.method, headers: jsonHeaders, body });
    if (![401, 405].includes(res.status)) open.push(`${r.key} -> ${res.status}`);
  }
  expect(open).toEqual([]);
});

test('every admin route refuses members', async () => {
  await setupOwner(t, { mode: 'community' });
  const member = await addUser(t, 'sinta');
  const admin = apiRoutes(t.app).filter((r) => r.path.startsWith('/api/admin/'));
  expect(admin.length).toBeGreaterThan(5);
  const open: string[] = [];
  for (const r of admin) {
    const body = r.method === 'GET' ? undefined : '{}';
    const res = await t.app.request(r.path, {
      method: r.method,
      headers: { ...jsonHeaders, cookie: member.cookie },
      body,
    });
    if (res.status !== 403) open.push(`${r.key} -> ${res.status}`);
  }
  expect(open).toEqual([]);
});

test('unsafe requests from another site are refused on every mutating route', async () => {
  const { cookie } = await setupOwner(t);
  const open: string[] = [];
  for (const r of apiRoutes(t.app)) {
    if (r.method === 'GET' || r.method === 'HEAD') continue;
    const res = await t.app.request(r.path, {
      method: r.method,
      headers: { cookie, origin: 'https://evil.example', 'content-type': 'application/json' },
      body: '{}',
    });
    if (res.status !== 403) open.push(`${r.key} -> ${res.status}`);
  }
  expect(open).toEqual([]);
});
