import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { brotliCompressSync, brotliDecompressSync, gzipSync } from 'node:zlib';
import { Hono } from 'hono';
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { AppEnv } from './env';
import { notFoundHandler } from './errors';
import { serveWeb } from './static';

let root: string;
let app: Hono<AppEnv>;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'neotext-web-'));
  const dist = path.join(root, 'dist');
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<html>spa</html>');
  fs.writeFileSync(path.join(dist, 'assets', 'a.js'), 'console.log(1);');
  fs.writeFileSync(path.join(dist, 'assets', 'a.js.br'), brotliCompressSync('console.log(1);'));
  fs.writeFileSync(path.join(dist, 'assets', 'a.js.gz'), gzipSync('console.log(1);'));
  fs.writeFileSync(path.join(dist, 'theme-boot.js'), '/* boot */');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'top secret');
  app = new Hono<AppEnv>();
  app.get('/api/health', (c) => c.json({ ok: true }));
  serveWeb(app, dist);
  app.notFound(notFoundHandler);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test('assets are immutable', async () => {
  const res = await app.request('/assets/a.js');
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toContain('immutable');
  expect(await res.text()).toBe('console.log(1);');
});

test('assets go out precompressed when the browser takes it', async () => {
  const br = await app.request('/assets/a.js', { headers: { 'accept-encoding': 'gzip, br' } });
  expect(br.headers.get('content-encoding')).toBe('br');
  expect(br.headers.get('content-type')).toContain('javascript');
  expect(br.headers.get('cache-control')).toContain('immutable');
  expect(brotliDecompressSync(Buffer.from(await br.arrayBuffer())).toString()).toBe(
    'console.log(1);',
  );

  const gz = await app.request('/assets/a.js', { headers: { 'accept-encoding': 'gzip' } });
  expect(gz.headers.get('content-encoding')).toBe('gzip');

  const plain = await app.request('/assets/a.js');
  expect(plain.headers.get('content-encoding')).toBeNull();
  expect(await plain.text()).toBe('console.log(1);');
});

test('root and deep links fall back to index.html with no-cache', async () => {
  for (const url of ['/', '/c/cnv_123']) {
    const res = await app.request(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('spa');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  }
});

test('other existing files are served as themselves', async () => {
  const res = await app.request('/theme-boot.js');
  expect(res.status).toBe(200);
  expect(await res.text()).toBe('/* boot */');
  expect(res.headers.get('cache-control')).toBe('no-cache');
});

test('files are not served for non-GET methods', async () => {
  const res = await app.request('/theme-boot.js', { method: 'POST' });
  expect(res.status).toBe(404);
  expect(await res.text()).not.toContain('boot');
});

test('api routes are never the SPA', async () => {
  const known = await app.request('/api/health');
  expect(await known.json()).toEqual({ ok: true });
  const res = await app.request('/api/nope');
  expect(res.status).toBe(404);
  expect(res.headers.get('content-type')).toContain('application/json');
  expect(await res.text()).not.toContain('spa');
  expect((await app.request('/api')).status).toBe(404);
});

test('a missing asset is a 404, not the SPA', async () => {
  const res = await app.request('/assets/missing.js');
  expect(res.status).toBe(404);
});

test('refuses path traversal', async () => {
  for (const url of ['/..%2fsecret.txt', '/assets/..%2f..%2fsecret.txt']) {
    const res = await app.request(url);
    expect([400, 403, 404]).toContain(res.status);
    expect(await res.text()).not.toContain('top secret');
  }
});

test('a normalised dot-dot URL cannot leave the dist folder', async () => {
  // The URL parser collapses this to /secret.txt, which is just an SPA route.
  const res = await app.request('/%2e%2e/secret.txt');
  expect(await res.text()).not.toContain('top secret');
});

test('non-GET requests are not answered by the SPA', async () => {
  const res = await app.request('/c/cnv_123', { method: 'POST' });
  expect(res.status).toBe(404);
});
