import http from 'node:http';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createTestApp, setupOwner, type TestApp } from '../../test-support/test-app';
import { startServer } from '../server';

const MiB = 1024 * 1024;
let t: TestApp;
let server: { port: number; close(): Promise<void> };
beforeEach(async () => {
  t = await createTestApp({ env: { NEOTEXT_PORT: '0' } });
  server = await startServer(t.c, t.app);
});
afterEach(async () => {
  await server.close();
  await t.close();
});

/**
 * Streams up to `total` bytes as a chunked body over a real socket, never faster than the
 * server takes them, and stops at the response: `sent` is how much got out before it came.
 */
function sendChunked(
  path: string,
  headers: Record<string, string>,
  total: number,
): Promise<{ status: number; sent: number; body: string }> {
  return new Promise((resolve, reject) => {
    let sent = 0;
    let answered = false;
    const req = http.request({
      host: '127.0.0.1',
      port: server.port,
      path,
      method: 'POST',
      headers: {
        ...headers,
        origin: 'http://localhost:3420',
        'content-type': 'multipart/form-data; boundary=x',
        'transfer-encoding': 'chunked',
      },
    });
    req.on('response', (res) => {
      answered = true;
      const at = sent;
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, sent: at, body: Buffer.concat(chunks).toString() });
        req.destroy();
      });
    });
    req.on('error', (err) => {
      if (!answered) reject(err);
    });
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    const pump = () => {
      while (!answered && sent < total) {
        sent += chunk.length;
        if (!req.write(chunk)) {
          req.once('drain', pump);
          return;
        }
      }
      if (!answered) req.end();
    };
    pump();
  });
}

test.each(['/api/import', '/api/attachments'])(
  'an unauthenticated chunked 50 MiB upload to %s is refused before it is read',
  async (path) => {
    const res = await sendChunked(path, {}, 50 * MiB);
    expect(res.status).toBe(401);
    // The answer came while most of the body was still unsent: the server never waited for it.
    expect(res.sent).toBeLessThan(16 * MiB);
  },
);

test('a signed-in chunked upload to a large-body route is a 411 before it is read', async () => {
  const { cookie } = await setupOwner(t);
  const res = await sendChunked('/api/import', { cookie }, 50 * MiB);
  expect(res.status).toBe(411);
  expect(JSON.parse(res.body)).toMatchObject({
    error: { code: 'bad_request', details: { reason: 'length_required' } },
  });
  expect(res.sent).toBeLessThan(16 * MiB);
});

test('a chunked body elsewhere is still held to the 1 MiB default', async () => {
  const res = await sendChunked('/api/auth/login', {}, 8 * MiB);
  expect(res.status).toBe(413);
  expect(res.sent).toBeLessThan(8 * MiB);
});

test('a declared length over the route limit is refused without reading', async () => {
  const { cookie } = await setupOwner(t);
  const res = await t.app.request('/api/attachments', {
    method: 'POST',
    headers: {
      cookie,
      origin: 'http://localhost:3420',
      'content-type': 'multipart/form-data; boundary=x',
      'content-length': String(26 * MiB),
    },
    body: 'x',
  });
  expect(res.status).toBe(413);
});
