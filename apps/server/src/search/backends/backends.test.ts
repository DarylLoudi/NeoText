import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHttpClient } from '../../net/http-client';
import type { ResolvedProvider } from '../../providers/types';
import { getSearchBackend } from '../registry';
import { SearchError } from '../types';

interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let server: http.Server;
let base: string;
let seen: Seen[];
let status = 200;
let payload: unknown = {};
const client = createHttpClient({ allowPrivate: true });

beforeEach(async () => {
  seen = [];
  status = 200;
  payload = {};
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      seen.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

const provider = (kind: 'searxng' | 'brave' | 'tavily'): ResolvedProvider => ({
  id: 'prv_x',
  kind,
  baseUrl: base,
  apiKey: kind === 'searxng' ? null : 'fake-key-1234',
  headers: {},
  manualModels: [],
  http: client,
  appUrl: 'http://localhost',
});

const entry = { url: 'https://a.example/x', title: 'Title A', text: 'Snippet A' };
const bodies = (kind: string, items: unknown[]) =>
  kind === 'brave' ? { web: { results: items } } : { results: items };
const raw = (kind: string, e: { url?: string; title?: string; text?: string }) =>
  kind === 'brave'
    ? { url: e.url, title: e.title, description: e.text }
    : { url: e.url, title: e.title, content: e.text };
const run = (kind: 'searxng' | 'brave' | 'tavily', count = 5) =>
  getSearchBackend(kind).search(provider(kind), 'open source chatbot', {
    count,
    signal: AbortSignal.timeout(5000),
  });

describe.each(['searxng', 'brave', 'tavily'] as const)('%s', (kind) => {
  test('maps results and sends auth', async () => {
    payload = bodies(kind, [raw(kind, entry)]);
    const results = await run(kind);
    expect(results).toEqual([{ url: entry.url, title: 'Title A', snippet: 'Snippet A' }]);
    const req = seen[0];
    if (kind === 'searxng') {
      expect(req?.method).toBe('GET');
      expect(req?.url).toBe('/search?q=open+source+chatbot&format=json');
    } else if (kind === 'brave') {
      expect(req?.method).toBe('GET');
      expect(req?.url).toBe('/res/v1/web/search?q=open+source+chatbot&count=5');
      expect(req?.headers['x-subscription-token']).toBe('fake-key-1234');
    } else {
      expect(req?.method).toBe('POST');
      expect(req?.url).toBe('/search');
      expect(req?.headers.authorization).toBe('Bearer fake-key-1234');
      expect(JSON.parse(req?.body ?? '{}')).toEqual({
        query: 'open source chatbot',
        max_results: 5,
      });
    }
  });

  test('count limits results', async () => {
    payload = bodies(
      kind,
      [1, 2, 3, 4].map((n) =>
        raw(kind, { url: `https://a.example/${n}`, title: `T${n}`, text: 's' }),
      ),
    );
    const results = await run(kind, 2);
    expect(results.map((r) => r.title)).toEqual(['T1', 'T2']);
  });

  test('malformed entries are skipped', async () => {
    payload = bodies(kind, [
      null,
      'text',
      raw(kind, { title: 'no url', text: 's' }),
      raw(kind, { url: 'https://a.example/n', text: 's' }),
      raw(kind, { url: 'ftp://a.example/f', title: 'ftp', text: 's' }),
      raw(kind, entry),
    ]);
    const results = await run(kind);
    expect(results.map((r) => r.url)).toEqual([entry.url]);
  });

  test('titles and snippets stay plain text', async () => {
    payload = bodies(kind, [
      raw(kind, {
        url: entry.url,
        title: 'A &amp; B',
        text: 'Hello <strong>world</strong><script>x()</script> &lt;ok&gt;',
      }),
    ]);
    const [r] = await run(kind);
    expect(r?.title).toBe('A & B');
    expect(r?.snippet).toBe('Hello worldx() <ok>');
  });

  test('http errors throw SearchError', async () => {
    status = 429;
    payload = { error: 'slow down' };
    await expect(run(kind)).rejects.toMatchObject({ name: 'SearchError', status: 429 });
    status = 500;
    await expect(run(kind)).rejects.toBeInstanceOf(SearchError);
  });

  test('a body that is not JSON throws SearchError without a status', async () => {
    payload = '<html>nope</html>';
    await expect(run(kind)).rejects.toMatchObject({ name: 'SearchError', status: null });
  });
});

test('brave defaults to its public API when the base URL is empty', async () => {
  const p = { ...provider('brave'), baseUrl: '' };
  // The default host is not reachable in tests; the request must at least target it.
  const fetched: string[] = [];
  const spy = {
    ...client,
    fetch: async (url: string) => {
      fetched.push(url);
      return new Response('{"web":{"results":[]}}');
    },
  } as unknown as ResolvedProvider['http'];
  await getSearchBackend('brave').search({ ...p, http: spy }, 'q', {
    count: 1,
    signal: AbortSignal.timeout(1000),
  });
  expect(fetched[0]).toBe('https://api.search.brave.com/res/v1/web/search?q=q&count=1');
});

test('an oversized answer is cut off and becomes a SearchError', async () => {
  let sent = 0;
  server.removeAllListeners('request');
  server.on('request', (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    const chunk = Buffer.alloc(64 * 1024, 'a');
    const pump = () => {
      while (sent < 64 * 1024 * 1024 && !res.destroyed) {
        sent += chunk.length;
        if (!res.write(chunk)) return void res.once('drain', pump);
      }
    };
    pump();
  });
  await expect(run('searxng')).rejects.toMatchObject({ name: 'SearchError', status: null });
  expect(sent).toBeLessThan(16 * 1024 * 1024);
});
