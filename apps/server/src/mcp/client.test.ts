import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { type MockMcpServer, startMockMcpServer } from '../../test-support/mock-mcp-server';
import { createHttpClient, type HttpClient } from '../net/http-client';
import { connectMcp, guardedFetch } from './client';

let http: HttpClient;
const mocks: MockMcpServer[] = [];
beforeAll(() => {
  http = createHttpClient({ allowPrivate: true });
});
afterEach(async () => {
  await Promise.all(mocks.splice(0).map((m) => m.close()));
});
afterAll(async () => {
  await http.close();
});

async function mock(redirects?: Record<string, string>): Promise<MockMcpServer> {
  const m = await startMockMcpServer(redirects ? { redirects } : {});
  mocks.push(m);
  return m;
}
const origin = (m: MockMcpServer) => new URL(m.url).origin;

test('a same-origin redirect is followed, with the headers', async () => {
  const m = await mock({ '/old': '/mcp' });
  const conn = await connectMcp(`${origin(m)}/old`, { 'x-api-key': 'secret' }, http);
  try {
    expect((await conn.listTools()).map((t) => t.name)).toContain('echo');
    expect(m.lastHeaders()?.['x-api-key']).toBe('secret');
  } finally {
    await conn.close();
  }
});

test('a redirect to another origin is refused, so custom headers never leave', async () => {
  const target = await mock();
  // Same host, another port: a different origin.
  const front = await mock({ '/mcp': target.url });
  await expect(connectMcp(front.url, { 'x-api-key': 'secret' }, http)).rejects.toThrow();
  expect(target.requestCount()).toBe(0);
});

test('a redirect loop ends with an error', async () => {
  const m = await mock({ '/a': '/b', '/b': '/a' });
  await expect(connectMcp(`${origin(m)}/a`, {}, http)).rejects.toThrow();
  expect(m.requestCount()).toBeLessThanOrEqual(12);
});

describe('guarded fetch', () => {
  const post = { method: 'POST', headers: { 'x-api-key': 'secret' }, body: '{}' };

  test('refuses a cross-origin Location itself, whoever calls it', async () => {
    const target = await mock();
    const front = await mock({ '/mcp': target.url });
    await expect(guardedFetch(http)(front.url, post)).rejects.toThrow(
      'The MCP server redirected to another site, which is not allowed.',
    );
    expect(target.requestCount()).toBe(0);
  });

  test('follows a same-origin redirect with the method, body and headers', async () => {
    const m = await mock({ '/old': '/mcp' });
    const res = await guardedFetch(http)(`${origin(m)}/old`, {
      ...post,
      headers: {
        ...post.headers,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 't', version: '1' },
        },
      }),
    });
    await res.body?.cancel();
    expect(res.status).toBe(200);
    expect(m.requestCount()).toBe(2);
    expect(m.lastHeaders()?.['x-api-key']).toBe('secret');
  });

  test('stops after too many redirects', async () => {
    const m = await mock({ '/a': '/b', '/b': '/a' });
    await expect(guardedFetch(http)(`${origin(m)}/a`, post)).rejects.toThrow(
      'The MCP server redirected too many times.',
    );
  });
});
