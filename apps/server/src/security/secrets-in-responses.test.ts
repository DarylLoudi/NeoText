import { afterEach, beforeEach, expect, test } from 'vitest';
import { type MockProvider, startMockProvider } from '../../test-support/mock-provider';
import {
  addUser,
  authed,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';

const OWN_KEY = `sk-or-v1-${'a1'.repeat(32)}`;
const SHARED_KEY = 'sk-shared-test-0123456789abcdefghij';
const SECRETS = [
  OWN_KEY,
  SHARED_KEY,
  'provider-header-secret',
  'mcp-header-secret',
  // The tail of each key: a hint never shows more than a few characters.
  OWN_KEY.slice(-12),
  SHARED_KEY.slice(-12),
];

let t: TestApp;
let mock: MockProvider;
beforeEach(async () => {
  t = await createTestApp();
  mock = await startMockProvider();
  mock.models = ['m1'];
});
afterEach(async () => {
  await t.close();
  await mock.close();
});

test('no endpoint returns a stored key', async () => {
  const owner = await setupOwner(t, { mode: 'community' });
  const admin = authed(t, owner.cookie);
  const member = authed(t, (await addUser(t, 'sinta')).cookie);
  const post = (as: typeof admin, path: string, body: unknown) =>
    as(path, { method: 'POST', body: JSON.stringify(body) });

  const created: string[] = [];
  for (const [as, body] of [
    [admin, { kind: 'openrouter', name: 'OR', apiKey: OWN_KEY }],
    [
      admin,
      {
        kind: 'openai-compatible',
        name: 'Lab',
        baseUrl: mock.url,
        apiKey: SHARED_KEY,
        headers: { 'X-Team': 'provider-header-secret' },
        shared: true,
      },
    ],
    [member, { kind: 'openrouter', name: 'Mine', apiKey: OWN_KEY }],
  ] as const) {
    const res = await post(as, '/api/providers', body);
    expect(res.status).toBe(201);
    const text = await res.text();
    for (const s of SECRETS) expect(text).not.toContain(s);
    created.push((JSON.parse(text) as { provider: { id: string } }).provider.id);
  }
  const mcp = await post(admin, '/api/mcp-servers', {
    name: 'tools',
    url: 'http://127.0.0.1:9/mcp',
    headers: { Authorization: 'Bearer mcp-header-secret' },
  });
  expect(mcp.status).toBe(201);
  const mcpText = await mcp.text();
  expect(mcpText).not.toContain('mcp-header-secret');
  const mcpId = (JSON.parse(mcpText) as { server: { id: string } }).server.id;

  // Every GET endpoint without a path param, plus the ones that take a provider or MCP id.
  const gets = new Set<string>();
  for (const r of t.app.routes) {
    if (r.method === 'GET' && r.path.startsWith('/api/') && !r.path.includes(':')) {
      gets.add(r.path);
    }
  }
  expect(gets.size).toBeGreaterThan(20);
  for (const id of created) gets.add(`/api/providers/${id}/models`);
  gets.add(`/api/mcp-servers/${mcpId}`);
  const leaks: string[] = [];
  for (const as of [admin, member]) {
    for (const path of gets) {
      const text = await (await as(path)).text();
      for (const s of SECRETS) if (text.includes(s)) leaks.push(`${path} has ${s.slice(0, 8)}…`);
    }
  }
  expect(leaks).toEqual([]);
});
