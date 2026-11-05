type Body = {
  error: { code: string; requestId: string; message: string; details?: unknown };
};

import { afterEach, beforeEach, expect, test } from 'vitest';
import { createTestApp, type TestApp } from '../test-support/test-app';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

test('GET /api/health', async () => {
  const res = await t.app.request('/api/health');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, version: '0.2.0', db: 'ok' });
});
test('GET /api/health reports a database error with 503', async () => {
  t.c.db.raw.close();
  const res = await t.app.request('/api/health');
  expect(res.status).toBe(503);
  expect(await res.json()).toMatchObject({ ok: false, db: 'error' });
});
test('unknown api route is a JSON 404 with the request id', async () => {
  const res = await t.app.request('/api/nope');
  expect(res.status).toBe(404);
  const body = (await res.json()) as Body;
  expect(body.error.code).toBe('not_found');
  expect(body.error.requestId).toBe(res.headers.get('x-request-id'));
});
test('security headers', async () => {
  const res = await t.app.request('/api/health');
  expect(res.headers.get('content-security-policy')).toContain("script-src 'self'");
  expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
  expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
  expect(res.headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=()');
});
test.each([[{ Origin: 'https://evil.example' }], [{ 'Sec-Fetch-Site': 'cross-site' }]])(
  'unsafe request from another site is refused %o',
  async (headers) => {
    const res = await t.app.request('/api/health', { method: 'POST', headers });
    expect(res.status).toBe(403);
    expect(((await res.json()) as Body).error.code).toBe('forbidden');
  },
);
test('same-origin unsafe request passes the guard', async () => {
  const res = await t.app.request('/api/health', {
    method: 'POST',
    headers: { Origin: 'http://localhost:3420' },
  });
  expect(res.status).not.toBe(403);
});
test('oversized body is refused with 413', async () => {
  const res = await t.app.request('/api/health', {
    method: 'POST',
    headers: { 'Content-Length': String(2 * 1024 * 1024) },
    body: 'x',
  });
  expect(res.status).toBe(413);
  expect(((await res.json()) as Body).error.code).toBe('payload_too_large');
});
