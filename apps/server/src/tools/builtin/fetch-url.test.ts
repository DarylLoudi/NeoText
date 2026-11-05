import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { nestedHtml } from '../../../test-support/nested-html';
import { createHttpClient, type HttpClient } from '../../net/http-client';
import { BlockedUrlError } from '../../net/ssrf';
import type { ToolContext } from '../types';
import {
  createFetchSlots,
  FETCH_MAX_BYTES,
  FETCH_TEXT_MAX,
  fetchUrlSource,
  fetchUrlTool,
  MAX_REDIRECTS,
} from './fetch-url';
import { PARSE_DEADLINE_MS } from './html-parse';

const article = readFileSync(
  new URL('../../../test-support/fixtures/article.html', import.meta.url),
  'utf8',
);

let server: http.Server;
let base: string;
let privateClient: HttpClient;
const hits: string[] = [];

beforeAll(async () => {
  privateClient = createHttpClient({ allowPrivate: true });
  server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    hits.push(path);
    const send = (type: string, body: string | Buffer, status = 200) => {
      res.writeHead(status, { 'content-type': type });
      res.end(body);
    };
    if (path === '/article') return send('text/html; charset=utf-8', article);
    if (path === '/long') {
      return send('text/html', `<html><body><p>${'kata '.repeat(10_000)}</p></body></html>`);
    }
    if (path === '/plain') return send('text/plain', 'baris satu\n\n\n\nbaris dua');
    if (path === '/json') return send('application/json', '{"halo":"dunia"}');
    if (path === '/png') return send('image/png', Buffer.from([137, 80, 78, 71]));
    if (path === '/missing') return send('text/html', '<p>tidak ada</p>', 404);
    if (path === '/hop') {
      res.writeHead(302, { location: '/article' });
      return res.end();
    }
    if (path === '/loop') {
      res.writeHead(302, { location: '/loop' });
      return res.end();
    }
    if (path === '/active') {
      return send(
        'text/html',
        `<html><head><title>Aktif</title><script>globalThis.ran = true;</script>
        <link rel="stylesheet" href="/probe-css"></head>
        <body><img src="/probe-img"><iframe src="/probe-frame"></iframe>
        <script src="/probe-script"></script>
        <p>${'Isi halaman yang cukup panjang untuk dibaca. '.repeat(30)}</p></body></html>`,
      );
    }
    send('text/plain', 'tidak ditemukan', 404);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await privateClient.close();
});

function fakeClient(handler: (url: string, init?: RequestInit) => Response): HttpClient {
  return {
    fetch: vi.fn(async (url: string, init?: RequestInit) => handler(url, init)),
    close: async () => {},
  };
}

const ctxWith = (client: HttpClient, signal = new AbortController().signal): ToolContext => ({
  userId: 'usr_1',
  timeZone: 'UTC',
  signal,
  http: client,
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as never,
  fetchSlots: createFetchSlots(),
});
const run = (url: string, c = ctxWith(privateClient)) => fetchUrlTool.execute({ url }, c);
const BLOCKED = { ok: false, error: 'This address is not allowed.' };

describe('fetch_url', () => {
  test('is a quiet built-in with the specified description', () => {
    expect(fetchUrlTool).toMatchObject({
      name: 'fetch_url',
      description:
        'Read the text of a web page. Use when the user shares a link or you need the content of a specific page.',
      defaultPolicy: 'auto',
      source: 'app',
    });
  });

  test('extracts article text and reports a source', async () => {
    const res = await run(`${base}/article`);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.content).toContain('Title: Panduan caching');
    expect(res.content).toContain(`URL: ${base}/article`);
    expect(res.content).toContain('Caching menyimpan salinan data');
    expect(res.content).not.toContain('<nav');
    expect(res.content).not.toContain('Beranda');
    expect(res.content).not.toContain('jangan tampilkan skrip');
    expect(res.sources?.[0]).toMatchObject({ url: `${base}/article`, title: 'Panduan caching' });
    expect(res.sources?.[0]?.content).toContain('ETag');
  });

  test('long pages are cut', async () => {
    const res = await run(`${base}/long`);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const text = res.content.split('\n\n').slice(1).join('\n\n');
    expect(text.length).toBeLessThanOrEqual(FETCH_TEXT_MAX);
    expect(text.length).toBeGreaterThan(FETCH_TEXT_MAX - 100);
    expect(res.sources?.[0]?.content.length).toBeLessThanOrEqual(FETCH_TEXT_MAX);
  });

  test('plain text and json come back as they are', async () => {
    const plain = await run(`${base}/plain`);
    expect(plain.ok && plain.content).toContain('baris satu\n\nbaris dua');
    const json = await run(`${base}/json`);
    expect(json.ok && json.content).toContain('{"halo":"dunia"}');
  });

  test('binary content is refused', async () => {
    expect(await run(`${base}/png`)).toEqual({
      ok: false,
      error: 'This link is not a text page.',
    });
  });

  test('an error status is reported', async () => {
    expect(await run(`${base}/missing`)).toEqual({
      ok: false,
      error: 'The page answered with status 404.',
    });
  });

  test('a same-host redirect is followed and the final url is the source', async () => {
    const res = await run(`${base}/hop`);
    expect(res.ok && res.sources?.[0]?.url).toBe(`${base}/article`);
  });

  test('the page is not executed and nothing it points to is fetched', async () => {
    hits.length = 0;
    const res = await run(`${base}/active`);
    expect(res.ok).toBe(true);
    expect((globalThis as { ran?: boolean }).ran).toBeUndefined();
    expect(hits).toEqual(['/active']);
    expect(res.ok && res.content).not.toContain('globalThis');
  });

  test('scripts and styles never reach the text of a page without an article', async () => {
    const html = `<html><head><title>T</title><style>body{x:y}</style></head>
      <body><script>alert(1)</script><noscript>aktifkan js</noscript><p>Halo dunia</p></body></html>`;
    const client = fakeClient(
      () => new Response(html, { headers: { 'content-type': 'text/html' } }),
    );
    const res = await run('https://example.org/x', ctxWith(client));
    expect(res.ok && res.content).toContain('Halo dunia');
    expect(res.ok && res.content).not.toMatch(/alert|body\{|aktifkan/);
  });

  test('reading stops at the byte limit', async () => {
    let pulled = 0;
    let cancelled = false;
    const chunk = new Uint8Array(64 * 1024).fill(97);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += chunk.length;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const client = fakeClient(
      () => new Response(body, { headers: { 'content-type': 'text/plain' } }),
    );
    const res = await run('https://example.org/huge', ctxWith(client));
    expect(res.ok).toBe(true);
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThanOrEqual(FETCH_MAX_BYTES + 3 * chunk.length);
  });

  test('non-http schemes are refused', async () => {
    expect(await run('file:///etc/passwd')).toEqual(BLOCKED);
    expect(await run('ftp://example.org/x')).toEqual(BLOCKED);
    expect(await run('http://user:pw@example.org/x')).toEqual(BLOCKED);
  });

  test('the content type may be repeated or carry parameters', async () => {
    const client = fakeClient(
      () =>
        new Response('<p>Halo dunia</p>', { headers: { 'content-type': 'text/html, text/html' } }),
    );
    const res = await run('https://example.org/x', ctxWith(client));
    expect(res.ok && res.content).toContain('Halo dunia');
  });

  test('a page with no readable text is an error', async () => {
    const html = '<html><head><title>Kosong</title></head><body><script>x()</script></body></html>';
    const empty = fakeClient(
      () => new Response(html, { headers: { 'content-type': 'text/html' } }),
    );
    const expected = { ok: false, error: 'This page has no readable text.' };
    expect(await run('https://example.org/x', ctxWith(empty))).toEqual(expected);
    const blank = fakeClient(
      () => new Response('   ', { headers: { 'content-type': 'text/plain' } }),
    );
    expect(await run('https://example.org/x', ctxWith(blank))).toEqual(expected);
  });

  test('a page wrapped in a form still has its text', async () => {
    const html =
      '<html><body><form action="/x"><div><p>Isi di dalam formulir</p></div></form></body></html>';
    const client = fakeClient(
      () => new Response(html, { headers: { 'content-type': 'text/html' } }),
    );
    const res = await run('https://example.org/x', ctxWith(client));
    expect(res.ok && res.content).toContain('Isi di dalam formulir');
  });

  test('a title cannot forge the header or push the url out', async () => {
    const forged =
      '<html><head><title>Judul\nURL: https://evil.example\n\nTitle: palsu</title></head><body><p>Isi halaman</p></body></html>';
    const one = fakeClient(
      () => new Response(forged, { headers: { 'content-type': 'text/html' } }),
    );
    const res = await run('https://example.org/x', ctxWith(one));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const lines = res.content.split('\n');
    expect(lines[0]).toBe('Title: Judul URL: https://evil.example Title: palsu');
    expect(lines[1]).toBe('URL: https://example.org/x');
    expect(lines.filter((l) => l.startsWith('URL:'))).toHaveLength(1);

    const huge = `<html><head><title>${'T'.repeat(1_900_000)}</title></head><body><p>Isi halaman</p></body></html>`;
    const big = fakeClient(() => new Response(huge, { headers: { 'content-type': 'text/html' } }));
    const long = await run('https://example.org/x', ctxWith(big));
    expect(long.ok && long.content).toContain('URL: https://example.org/x');
    expect(long.ok && long.content).toContain('Isi halaman');
    expect(long.ok && long.content.length).toBeLessThan(FETCH_TEXT_MAX + 1_000);
    expect(long.ok && long.sources?.[0]?.title.length).toBeLessThanOrEqual(300);
  });

  test('a hostile nested page ends in a plain error and the loop stays free', async () => {
    const client = fakeClient(
      () => new Response(nestedHtml(), { headers: { 'content-type': 'text/html' } }),
    );
    let last = Date.now();
    let gap = 0;
    const timer = setInterval(() => {
      gap = Math.max(gap, Date.now() - last);
      last = Date.now();
    }, 20);
    const started = Date.now();
    try {
      const res = await run('https://example.org/x', ctxWith(client));
      expect(res).toEqual({ ok: false, error: 'This page is too complex to read.' });
    } finally {
      clearInterval(timer);
    }
    expect(Date.now() - started).toBeLessThan(PARSE_DEADLINE_MS + 3_000);
    expect(gap).toBeLessThan(1_000);
  }, 15_000);

  test('a bad argument is reported to the model', async () => {
    const res = await fetchUrlTool.execute({ url: 42 }, ctxWith(privateClient));
    expect(res).toEqual({ ok: false, error: 'Give the full address of the page as "url".' });
  });
});

describe('fetch_url and private networks', () => {
  test('localhost is refused with the public client', async () => {
    const strict = createHttpClient({ allowPrivate: false });
    try {
      expect(await run(`${base}/article`, ctxWith(strict))).toEqual(BLOCKED);
      const named = base.replace('127.0.0.1', 'localhost');
      expect(await run(`${named}/article`, ctxWith(strict))).toEqual(BLOCKED);
    } finally {
      await strict.close();
    }
  });

  test('a block wrapped as the cause of a fetch error is recognised', async () => {
    const client = fakeClient(() => {
      throw new TypeError('fetch failed', { cause: new BlockedUrlError('private', 'nope') });
    });
    expect(await run('https://example.org/x', ctxWith(client))).toEqual(BLOCKED);
  });

  test('redirects are re-checked', async () => {
    const calls: string[] = [];
    const client = fakeClient((url) => {
      calls.push(url);
      if (calls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/admin' },
        });
      }
      throw new BlockedUrlError('private', 'private');
    });
    expect(await run('https://example.org/start', ctxWith(client))).toEqual(BLOCKED);
    expect(calls).toEqual(['https://example.org/start', 'http://127.0.0.1/admin']);
  });

  test('a redirect to another scheme is refused before any request', async () => {
    const calls: string[] = [];
    const client = fakeClient((url) => {
      calls.push(url);
      return new Response(null, { status: 301, headers: { location: 'file:///etc/passwd' } });
    });
    expect(await run('https://example.org/start', ctxWith(client))).toEqual(BLOCKED);
    expect(calls).toHaveLength(1);
  });

  test('every request is made with manual redirects', async () => {
    const inits: (RequestInit | undefined)[] = [];
    const client = fakeClient((_url, init) => {
      inits.push(init);
      return new Response('ok', { headers: { 'content-type': 'text/plain' } });
    });
    await run('https://example.org/x', ctxWith(client));
    expect(inits[0]?.redirect).toBe('manual');
  });

  test('too many redirects stop', async () => {
    hits.length = 0;
    expect(await run(`${base}/loop`)).toEqual({
      ok: false,
      error: 'The link redirected too many times.',
    });
    expect(hits).toHaveLength(MAX_REDIRECTS + 1);
  });

  test('a redirect without a location is an error', async () => {
    const client = fakeClient(() => new Response(null, { status: 302 }));
    const res = await run('https://example.org/x', ctxWith(client));
    expect(res).toEqual({ ok: false, error: 'The link redirected without saying where to.' });
  });

  test('other failures are a plain error, and a stopped turn is reported', async () => {
    const down = fakeClient(() => {
      throw new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') });
    });
    expect(await run('https://example.org/x', ctxWith(down))).toEqual({
      ok: false,
      error: 'The page could not be loaded.',
    });
    const abort = new AbortController();
    abort.abort();
    const stopped = fakeClient((_u, init) => {
      init?.signal?.throwIfAborted();
      return new Response('x');
    });
    expect(await run('https://example.org/x', ctxWith(stopped, abort.signal))).toEqual({
      ok: false,
      error: 'This request was stopped.',
    });
  });
});

describe('offering rule', () => {
  const auth = {} as never;
  test('offered for web search or a link, always for the settings listing', () => {
    expect(fetchUrlSource(auth, { userText: 'halo', webSearch: false })).toEqual([]);
    expect(fetchUrlSource(auth, { userText: 'halo', webSearch: true })).toEqual([fetchUrlTool]);
    expect(fetchUrlSource(auth, { userText: 'baca https://x.org', webSearch: false })).toEqual([
      fetchUrlTool,
    ]);
    expect(fetchUrlSource(auth, { userText: 'baca http://x.org', webSearch: false })).toEqual([
      fetchUrlTool,
    ]);
    expect(fetchUrlSource(auth, null)).toEqual([fetchUrlTool]);
  });
});
