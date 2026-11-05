import type dns from 'node:dns';
import type { StreamEvent } from '@neotext/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { type MockMcpServer, startMockMcpServer } from '../../test-support/mock-mcp-server';
import { type MockProvider, startMockProvider } from '../../test-support/mock-provider';
import { readEvents } from '../../test-support/sse-client';
import { chunk, DONE, finish, textFrames } from '../../test-support/sse-frames';
import {
  addUser,
  authed,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';
import { sessionMiddleware } from '../auth/middleware';
import type { AppEnv } from '../http/env';
import { errorHandler } from '../http/errors';
import { mcpRoutes } from './routes';

type Finished = Extract<StreamEvent, { type: 'generation.finished' }>;
type ServerJson = { server: Record<string, unknown> & { id: string } };

let t: TestApp;
let mcp: MockMcpServer;
let api: ReturnType<typeof authed>;
let userId: string;
let ownerCookie: string;
beforeEach(async () => {
  t = await createTestApp();
  mcp = await startMockMcpServer();
  const owner = await setupOwner(t);
  userId = owner.user.id;
  ownerCookie = owner.cookie;
  api = authed(t, owner.cookie);
});
afterEach(async () => {
  for (const g of t.c.generations.active(userId)) t.c.generations.abort(userId, g.id);
  await t.close();
  await mcp.close();
});

const send = (path: string, method: string, value?: unknown, as = api) =>
  as(path, { method, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
const create = (value: unknown, as = api) => send('/api/mcp-servers', 'POST', value, as);

test('CRUD over HTTP', async () => {
  const created = await create({ name: 'test', url: mcp.url });
  expect(created.status).toBe(201);
  const { server } = (await created.json()) as ServerJson;
  expect(server).toEqual({
    id: expect.stringMatching(/^mcp_/),
    name: 'test',
    url: mcp.url,
    hasHeaders: false,
    enabled: true,
    createdAt: expect.any(Number),
    updatedAt: expect.any(Number),
  });
  const list = (await (await api('/api/mcp-servers')).json()) as { servers: { name: string }[] };
  expect(list.servers.map((s) => s.name)).toEqual(['test']);

  const patched = await send(`/api/mcp-servers/${server.id}`, 'PATCH', { name: 'Renamed' });
  expect(((await patched.json()) as ServerJson).server.name).toBe('Renamed');

  expect((await send(`/api/mcp-servers/${server.id}`, 'DELETE')).status).toBe(204);
  const after = (await (await api('/api/mcp-servers')).json()) as { servers: unknown[] };
  expect(after.servers).toEqual([]);
  expect((await send(`/api/mcp-servers/${server.id}`, 'DELETE')).status).toBe(404);
});

test('bodies are validated', async () => {
  expect((await create({ name: '', url: mcp.url })).status).toBe(400);
  expect((await create({ name: 'x'.repeat(41), url: mcp.url })).status).toBe(400);
  expect((await create({ name: 'ok', url: 'ftp://example.com/mcp' })).status).toBe(400);
  const eleven = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`x-h${i}`, 'v']));
  expect((await create({ name: 'ok', url: mcp.url, headers: eleven })).status).toBe(400);
  expect((await create({ name: 'ok', url: mcp.url, headers: { 'bad name': 'v' } })).status).toBe(
    400,
  );
});

test('headers are sealed; never returned', async () => {
  const secret = 'Bearer sekret-header-value-123';
  const res = await create({ name: 'test', url: mcp.url, headers: { Authorization: secret } });
  const { server } = (await res.json()) as ServerJson;
  expect(server.hasHeaders).toBe(true);
  expect(JSON.stringify(server)).not.toContain('sekret');
  const listed = await (await api('/api/mcp-servers')).text();
  expect(listed).not.toContain('sekret');
  const raw = t.c.db.raw.prepare('SELECT headers FROM mcp_servers WHERE id = ?').get(server.id) as {
    headers: Buffer;
  };
  expect(raw.headers.includes(Buffer.from('sekret'))).toBe(false);

  const tested = await send(`/api/mcp-servers/${server.id}/test`, 'POST');
  expect(await tested.json()).toMatchObject({ ok: true });
  expect(mcp.lastHeaders()?.authorization).toBe(secret);

  const removed = await send(`/api/mcp-servers/${server.id}`, 'PATCH', { headers: null });
  expect(((await removed.json()) as ServerJson).server.hasHeaders).toBe(false);
});

test('servers are private to their owner', async () => {
  const { server } = (await (await create({ name: 'test', url: mcp.url })).json()) as ServerJson;
  const other = authed(t, (await addUser(t, 'sinta')).cookie);
  const list = (await (await other('/api/mcp-servers')).json()) as { servers: unknown[] };
  expect(list.servers).toEqual([]);
  expect((await send(`/api/mcp-servers/${server.id}`, 'PATCH', { name: 'x' }, other)).status).toBe(
    404,
  );
  expect((await send(`/api/mcp-servers/${server.id}/test`, 'POST', undefined, other)).status).toBe(
    404,
  );
  expect((await send(`/api/mcp-servers/${server.id}`, 'DELETE', undefined, other)).status).toBe(
    404,
  );
});

test('members cannot use private addresses in community mode', async () => {
  t.c.instance.set('mode', 'community');
  const member = authed(t, (await addUser(t, 'sinta')).cookie);
  const refused = await create({ name: 'test', url: mcp.url }, member);
  expect(refused.status).toBe(400);
  expect(await refused.json()).toMatchObject({
    error: {
      message: 'This address is on a private network. Only the admin can add endpoints like that.',
    },
  });
  const metadata = await create({ name: 'meta', url: 'http://169.254.169.254/mcp' });
  expect(metadata.status).toBe(400);
  expect((await create({ name: 'test', url: mcp.url })).status).toBe(201);
});

test('a member left over after a switch back to personal mode gets no private access', async () => {
  // Personal mode closes sign-ups, but accounts made in community mode stay active.
  const leftover = await addUser(t, 'sinta');
  t.c.instance.set('mode', 'personal');
  const member = authed(t, leftover.cookie);
  expect((await create({ name: 'test', url: mcp.url }, member)).status).toBe(400);
  const provider = await member('/api/providers', {
    method: 'POST',
    body: JSON.stringify({ kind: 'openai-compatible', name: 'Lan', baseUrl: mcp.url }),
  });
  expect(provider.status).toBe(400);
  // The owner, an admin, still may.
  expect((await create({ name: 'test', url: mcp.url })).status).toBe(201);
});

test('test endpoint reports tools or the error', async () => {
  const { server } = (await (await create({ name: 'test', url: mcp.url })).json()) as ServerJson;
  const ok = (await (await send(`/api/mcp-servers/${server.id}/test`, 'POST')).json()) as {
    ok: true;
    tools: { name: string; description: string }[];
  };
  expect(ok.ok).toBe(true);
  expect(ok.tools).toContainEqual({ name: 'echo', description: 'Echo the text back.' });

  const dead = await startMockMcpServer();
  await dead.close();
  const { server: gone } = (await (
    await create({ name: 'gone', url: dead.url })
  ).json()) as ServerJson;
  const failed = await send(`/api/mcp-servers/${gone.id}/test`, 'POST');
  expect(failed.status).toBe(200);
  expect(await failed.json()).toEqual({ ok: false, message: expect.any(String) });
});

test('turn offers MCP tools and asks first', async () => {
  const provider: MockProvider = await startMockProvider();
  try {
    provider.models = ['m1'];
    const p = await send('/api/providers', 'POST', {
      kind: 'openai-compatible',
      name: 'Mock',
      baseUrl: provider.url,
    });
    const providerId = ((await p.json()) as { provider: { id: string } }).provider.id;
    await create({ name: 'test', url: mcp.url });

    const tools = (await (await api('/api/tools')).json()) as {
      tools: { name: string; source: string; policy: string }[];
    };
    expect(tools.tools).toContainEqual(
      expect.objectContaining({
        name: 'mcp_test_echo',
        source: 'mcp',
        policy: 'ask',
        mcp: { server: 'test', tool: 'echo' },
      }),
    );

    const callChunk = { index: 0, id: 'call_1', type: 'function' };
    provider.enqueue(
      {
        frames: [
          chunk({
            tool_calls: [{ ...callChunk, function: { name: 'mcp_test_echo', arguments: '' } }],
          }),
          chunk({ tool_calls: [{ index: 0, function: { arguments: '{"text":"hi"}' } }] }),
          finish('tool_calls'),
          DONE,
        ],
      },
      { frames: textFrames('Selesai') },
    );
    const res = await send('/api/chat', 'POST', {
      conversationId: null,
      parentId: null,
      userMessage: { text: 'Pakai alat' },
      targets: [{ providerId, modelId: 'm1' }],
    });
    const all = readEvents(res);
    const waiting = () => {
      const g = t.c.generations.active(userId)[0];
      const parts = (g && t.c.generations.get(g.id)?.snapshot().parts) || [];
      return parts.some((x) => x.type === 'tool_call' && x.status === 'awaiting_approval');
    };
    for (let i = 0; i < 500 && !waiting(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(waiting()).toBe(true);
    const sent = provider.requests.find((r) => r.path === '/v1/chat/completions')?.body as {
      tools?: { function: { name: string } }[];
    };
    expect(sent.tools?.map((x) => x.function.name)).toContain('mcp_test_echo');

    const g = t.c.generations.active(userId)[0];
    const approved = await send(`/api/generations/${g?.id}/approvals`, 'POST', {
      callId: 'call_1',
      decision: 'allow',
    });
    expect(approved.status).toBe(204);
    const fin = (await all).find((e): e is Finished => e.type === 'generation.finished');
    expect(fin?.message.parts[0]).toMatchObject({
      type: 'tool_call',
      name: 'mcp_test_echo',
      status: 'ok',
      source: 'mcp',
    });
    const second = provider.requests.filter((r) => r.path === '/v1/chat/completions')[1]?.body as {
      messages: { role: string; content: string }[];
    };
    expect(second.messages.at(-1)).toMatchObject({ role: 'tool', content: 'echo: hi' });
  } finally {
    await provider.close();
  }
});

test('a user can add at most 10 servers', async () => {
  for (let i = 0; i < 10; i++) {
    expect((await create({ name: `s${i}`, url: mcp.url })).status).toBe(201);
  }
  const refused = await create({ name: 's10', url: mcp.url });
  expect(refused.status).toBe(400);
  expect(await refused.json()).toMatchObject({
    error: { message: 'You can add up to 10 tool servers.' },
  });
});

test('names that are the same after sanitizing are refused', async () => {
  const taken = 'Another tool server already uses that name.';
  const { server } = (await (
    await create({ name: 'my server', url: mcp.url })
  ).json()) as ServerJson;
  const clash = await create({ name: 'my.server', url: mcp.url });
  expect(clash.status).toBe(400);
  expect(await clash.json()).toMatchObject({ error: { message: taken } });

  const { server: other } = (await (
    await create({ name: 'other', url: mcp.url })
  ).json()) as ServerJson;
  const rename = await send(`/api/mcp-servers/${other.id}`, 'PATCH', { name: 'my_server' });
  expect(rename.status).toBe(400);
  expect(await rename.json()).toMatchObject({ error: { message: taken } });
  // Same sanitized name as itself: only another server's name counts as taken.
  const self = await send(`/api/mcp-servers/${server.id}`, 'PATCH', { name: 'my_server' });
  expect(self.status).toBe(200);
  const renamed = await send(`/api/mcp-servers/${server.id}`, 'PATCH', { name: 'my-server' });
  expect(renamed.status).toBe(200);
});

/** The MCP routes alone, with every host lookup answering after `delayMs` with a public IP. */
function slowLookupApp(delayMs: number) {
  const lookup = ((
    _host: string,
    _opts: unknown,
    cb: (e: null, a: dns.LookupAddress[]) => void,
  ) => {
    setTimeout(() => cb(null, [{ address: '93.184.216.34', family: 4 }]), delayMs);
  }) as unknown as typeof dns.lookup;
  const app = new Hono<AppEnv>();
  app.use('/api/*', sessionMiddleware(t.c));
  app.route('/api', mcpRoutes(t.c, { lookup }));
  app.onError(errorHandler(t.c));
  return { app };
}

test('concurrent creates cannot pass the server cap', async () => {
  for (let i = 0; i < 9; i++) await create({ name: `s${i}`, url: mcp.url });
  const { app } = slowLookupApp(100);
  const res = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      app.request('/api/mcp-servers', {
        method: 'POST',
        headers: { cookie: ownerCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name: `race${i}`, url: 'https://slow.example/mcp' }),
      }),
    ),
  );
  expect(res.map((r) => r.status).sort()).toEqual([201, 400, 400, 400]);
  for (const r of res.filter((x) => x.status === 400)) {
    expect(await r.json()).toMatchObject({
      error: { message: 'You can add up to 10 tool servers.' },
    });
  }
  const list = (await (await api('/api/mcp-servers')).json()) as { servers: unknown[] };
  expect(list.servers).toHaveLength(10);
});

test('concurrent renames cannot take the same name', async () => {
  const ids: string[] = [];
  for (const name of ['a', 'b']) {
    ids.push(((await (await create({ name, url: mcp.url })).json()) as ServerJson).server.id);
  }
  const { app } = slowLookupApp(100);
  const res = await Promise.all(
    ids.map((id) =>
      app.request(`/api/mcp-servers/${id}`, {
        method: 'PATCH',
        headers: { cookie: ownerCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'same', url: 'https://slow.example/mcp' }),
      }),
    ),
  );
  expect(res.map((r) => r.status).sort()).toEqual([200, 400]);
  const names = (
    (await (await api('/api/mcp-servers')).json()) as { servers: { name: string }[] }
  ).servers
    .map((s) => s.name)
    .sort();
  expect(names.filter((n) => n === 'same')).toHaveLength(1);
});
