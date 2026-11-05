import type { StreamEvent } from '@neotext/shared';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { type MockProvider, startMockProvider } from '../../test-support/mock-provider';
import { readEvents } from '../../test-support/sse-client';
import { authed, createTestApp, setupOwner, type TestApp } from '../../test-support/test-app';
import { createLogger } from '../lib/logger';

const PASSWORD = 'correct horse battery';
const KEY = `sk-or-v1-test0000${'0'.repeat(48)}`;
const SECRET_TEXT = 'PESAN-RAHASIA-123';
const MCP_HEADER = 'Bearer mcp-header-secret-42';

let t: TestApp;
let mock: MockProvider;
let lines: string[];
beforeEach(async () => {
  lines = [];
  // The real logger, at its most verbose, writing into `lines`.
  const log = createLogger({ logLevel: 'trace', env: 'test' }, { write: (l) => lines.push(l) });
  t = await createTestApp({ log });
  t.app.get('/api/boom', () => {
    throw new Error('boom');
  });
  mock = await startMockProvider();
  mock.models = ['m1'];
});
afterEach(async () => {
  await t.close();
  await mock.close();
});

test('secrets and chat text never reach the logs', async () => {
  const owner = await setupOwner(t, { password: PASSWORD });
  const api = authed(t, owner.cookie);
  const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });

  // A wrong and a right sign-in.
  const login = (password: string) =>
    t.app.request('/api/auth/login', {
      method: 'POST',
      headers: { origin: 'http://localhost:3420', 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'daryl', password }),
    });
  expect((await login(`${PASSWORD}!`)).status).toBe(401);
  const signedIn = await login(PASSWORD);
  expect(signedIn.status).toBe(200);
  const session = signedIn.headers.get('set-cookie') ?? '';

  const created = await api(
    '/api/providers',
    json('POST', { kind: 'openai-compatible', name: 'Mock', baseUrl: mock.url, apiKey: KEY }),
  );
  expect(created.status).toBe(201);
  const providerId = ((await created.json()) as { provider: { id: string } }).provider.id;
  await api(
    '/api/mcp-servers',
    json('POST', {
      name: 'tools',
      url: 'http://127.0.0.1:9/mcp',
      headers: { Authorization: MCP_HEADER },
    }),
  );

  // A chat whose upstream fails twice (the retry too), so the error paths log.
  const failure = { status: 500, body: JSON.stringify({ error: { message: 'upstream down' } }) };
  mock.enqueue(failure, failure);
  const res = await api(
    '/api/chat',
    json('POST', {
      conversationId: null,
      parentId: null,
      userMessage: { text: SECRET_TEXT },
      targets: [{ providerId, modelId: 'm1' }],
      options: {},
    }),
  );
  const events = (await readEvents(res)) as StreamEvent[];
  const done = events.find((e) => e.type === 'generation.finished');
  expect(done?.type === 'generation.finished' && done.message.status).toBe('error');
  // A forced unhandled error logs its error object too.
  await t.app.request('/api/boom', { headers: { cookie: owner.cookie } });
  await t.c.providers.flushBackground();

  const logs = lines.join('');
  expect(logs.length).toBeGreaterThan(0);
  expect(logs).toContain('generation finished');
  expect(logs).not.toContain(PASSWORD);
  expect(logs).not.toContain('sk-or-v1-test0000');
  expect(logs).not.toContain(SECRET_TEXT);
  expect(logs).not.toContain('mcp-header-secret-42');
  expect(logs).not.toContain(owner.recoveryKey);
  expect(logs).not.toMatch(/neotext_session=/);
  for (const token of [owner.cookie, session.split(';')[0] ?? '']) {
    const value = token.slice(token.indexOf('=') + 1);
    if (value) expect(logs).not.toContain(value);
  }
});
