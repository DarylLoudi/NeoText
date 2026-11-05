import { afterEach, beforeEach, expect, test } from 'vitest';
import { authed, createTestApp, setupOwner, type TestApp } from '../../test-support/test-app';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
let t: TestApp;
let cookie: string;
beforeEach(async () => {
  t = await createTestApp();
  ({ cookie } = await setupOwner(t));
});
afterEach(() => t.close());

function stubFetch(reply: () => Response) {
  const urls: string[] = [];
  t.c.http.tools.fetch = async (url) => {
    urls.push(url);
    return reply();
  };
  return urls;
}

test('route headers', async () => {
  stubFetch(() => new Response(PNG, { headers: { 'content-type': 'text/html' } }));
  const res = await authed(t, cookie)('/api/favicon?host=example.com');
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('image/png');
  expect(res.headers.get('cache-control')).toBe('private, max-age=604800');
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
  expect(res.headers.get('content-security-policy')).toContain('sandbox');
  expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
});

test('signed-out is 401', async () => {
  const res = await t.app.request('/api/favicon?host=example.com');
  expect(res.status).toBe(401);
});

test('invalid host is 400 and never fetches', async () => {
  const urls = stubFetch(() => new Response(PNG));
  for (const h of ['localhost', '..%2Fetc', '']) {
    expect((await authed(t, cookie)(`/api/favicon?host=${h}`)).status).toBe(400);
  }
  expect((await authed(t, cookie)('/api/favicon')).status).toBe(400);
  expect(urls).toHaveLength(0);
});

test('miss is 404', async () => {
  stubFetch(() => new Response('nope', { status: 404 }));
  expect((await authed(t, cookie)('/api/favicon?host=missing.example')).status).toBe(404);
});
