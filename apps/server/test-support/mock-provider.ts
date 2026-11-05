import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { textFrames } from './sse-frames';

export interface MockScript {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  frames?: (string | Uint8Array | { delayMs: number })[];
  hangAfterFrames?: boolean;
  /** Played only for a request naming this model; requests for other models pass it by. */
  model?: string;
}

export interface MockProvider {
  /** `http://127.0.0.1:<port>/v1` */
  url: string;
  enqueue(...scripts: MockScript[]): void;
  requests: { path: string; headers: Record<string, string>; body: unknown }[];
  models: string[];
  /** Status returned by `GET /v1/key`; 200 by default. */
  keyStatus: number;
  /** Raw JSON returned by `GET /v1/models` instead of the `models` ids; null by default. */
  modelsBody: string | null;
  /** Status of `GET /v1/models`; 200 by default. */
  modelsStatus: number;
  /** Chat responses whose connection is still open. */
  openChats(): number;
  /** Drops queued scripts and recorded requests. */
  reset(): void;
  close(): Promise<void>;
}

const tick = () => new Promise<void>((r) => setImmediate(r));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function startMockProvider(): Promise<MockProvider> {
  const queue: MockScript[] = [];
  const active = new Set<http.ServerResponse>();
  const mock: MockProvider = {
    url: '',
    enqueue: (...scripts) => {
      queue.push(...scripts);
    },
    requests: [],
    models: [],
    keyStatus: 200,
    modelsBody: null,
    modelsStatus: 200,
    openChats: () => active.size,
    reset: () => {
      queue.length = 0;
      mock.requests.length = 0;
      mock.keyStatus = 200;
      mock.modelsBody = null;
      mock.modelsStatus = 200;
    },
    close: async () => {
      for (const res of active) res.destroy();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };

  const json = (res: http.ServerResponse, value: unknown) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  };

  const play = async (res: http.ServerResponse, s: MockScript) => {
    const status = s.status ?? 200;
    if (s.body !== undefined) {
      res.writeHead(status, { 'content-type': 'application/json', ...s.headers });
      res.end(s.body);
      return;
    }
    res.writeHead(status, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      ...s.headers,
    });
    res.flushHeaders();
    for (const f of s.frames ?? []) {
      if (res.destroyed) return;
      if (typeof f === 'object' && !(f instanceof Uint8Array)) await sleep(f.delayMs);
      else {
        res.write(f);
        await tick();
      }
    }
    if (!s.hangAfterFrames && !res.destroyed) res.end();
  };

  const server = http.createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown = raw === '' ? null : raw;
      try {
        if (raw !== '') body = JSON.parse(raw);
      } catch {}
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k] = [v].flat().join(', ');
      mock.requests.push({ path, headers, body });

      if (req.method === 'GET' && path === '/v1/models') {
        if (mock.modelsBody !== null) {
          res.writeHead(mock.modelsStatus, { 'content-type': 'application/json' });
          res.end(mock.modelsBody);
        } else json(res, { data: mock.models.map((id) => ({ id })) });
      } else if (req.method === 'GET' && path === '/v1/key') {
        if (mock.keyStatus === 200) json(res, { data: { label: 'mock' } });
        else {
          res.writeHead(mock.keyStatus, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'key check failed', code: mock.keyStatus } }));
        }
      } else if (req.method === 'POST' && path === '/v1/chat/completions') {
        active.add(res);
        res.on('close', () => active.delete(res));
        const model = (body as { model?: unknown } | null)?.model;
        const at = queue.findIndex((s) => s.model === undefined || s.model === model);
        const script = at === -1 ? undefined : queue.splice(at, 1)[0];
        void play(res, script ?? { frames: textFrames('ok') });
      } else {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'not found' } }));
      }
    });
  });
  // Outlive undici's idle keep-alive, so a client never reuses a socket the mock is closing.
  server.keepAliveTimeout = 60_000;
  server.headersTimeout = 61_000;
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  mock.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  return mock;
}
