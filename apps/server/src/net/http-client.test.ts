import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHttpClient, type HttpClient } from './http-client';
import { BlockedUrlError } from './ssrf';

let server: http.Server;
let base: string;
const clients: HttpClient[] = [];
const make = (allowPrivate: boolean) => {
  const c = createHttpClient({ allowPrivate });
  clients.push(c);
  return c;
};

function causeChain(err: unknown): unknown[] {
  const out: unknown[] = [];
  let cur: unknown = err;
  while (cur && out.length < 10) {
    out.push(cur);
    cur = (cur as { cause?: unknown }).cause;
  }
  return out;
}

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.end('ok');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()));
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

describe('http client', () => {
  test('private client reaches localhost, public client is refused', async () => {
    const res = await make(true).fetch(`${base}/ok`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    await expect(make(false).fetch(`${base}/ok`)).rejects.toThrow();
  });

  test('refusal is a BlockedUrlError, directly or via the cause chain', async () => {
    const err = await make(false)
      .fetch(`${base}/ok`)
      .catch((e: unknown) => e);
    const found = causeChain(err).find((e) => e instanceof BlockedUrlError);
    expect(found).toMatchObject({ reason: 'private' });
  });

  test('literal IPv6 loopback is refused for the public client', async () => {
    const err = await make(false)
      .fetch('http://[::1]:9/')
      .catch((e: unknown) => e);
    expect(causeChain(err).some((e) => e instanceof BlockedUrlError)).toBe(true);
  });

  test('metadata literal refused even for the private client', async () => {
    await expect(make(true).fetch('http://169.254.169.254/latest')).rejects.toMatchObject({
      reason: 'metadata',
    });
  });

  test('bad scheme and credentials are refused before connecting', async () => {
    const c = make(true);
    await expect(c.fetch('file:///etc/passwd')).rejects.toMatchObject({ reason: 'scheme' });
    await expect(c.fetch('http://u:p@127.0.0.1/')).rejects.toMatchObject({
      reason: 'credentials',
    });
  });

  test('hostname resolving to loopback goes through the guarded lookup', async () => {
    const port = new URL(base).port;
    const err = await make(false)
      .fetch(`http://localhost:${port}/`)
      .catch((e: unknown) => e);
    expect(causeChain(err).some((e) => e instanceof BlockedUrlError)).toBe(true);
  });
});
