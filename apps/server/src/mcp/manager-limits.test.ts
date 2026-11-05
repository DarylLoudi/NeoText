import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { type MockMcpServer, startMockMcpServer } from '../../test-support/mock-mcp-server';
import {
  addUser,
  authContextFor,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';
import type { AuthContext } from '../http/env';
import type { McpConnection, McpToolInfo } from './client';
import {
  createMcpManager,
  MCP_LIST_WAIT_MS,
  MCP_RETRY_AFTER_MS,
  MCP_TURN_MAX_TOOLS,
  type McpManager,
  type McpManagerDeps,
} from './manager';
import { createMcpRepo } from './repo';

/** Hostile servers, limits and back-off: managers built directly, most with a fake connect. */
let t: TestApp;
let auth: AuthContext;
const managers: McpManager[] = [];
const mocks: MockMcpServer[] = [];
beforeEach(async () => {
  t = await createTestApp();
  auth = authContextFor(t, (await setupOwner(t)).cookie);
});
afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.closeAll()));
  await t.close();
  await Promise.all(mocks.splice(0).map((m) => m.close()));
});

const repo = () => createMcpRepo(t.c.db, t.c.clock);
const addServer = (name: string, url = `https://${name}.example/mcp`, as = auth) =>
  repo().create(as.userId, as.dek, { name, url });
const spyLog = () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() });

function manager(over: Partial<McpManagerDeps> = {}): McpManager {
  const m = createMcpManager({
    repo: repo(),
    http: t.c.http,
    clock: t.c.clock,
    log: t.c.log,
    ...over,
  });
  managers.push(m);
  return m;
}

const tools = (...names: string[]): McpToolInfo[] =>
  names.map((name) => ({ name, description: name, inputSchema: { type: 'object' } }));

/** A connect that serves `byHost[host]` tools, counting connects per host. */
function fakeConnect(byHost: Record<string, McpToolInfo[] | 'fail' | 'hang'>) {
  const calls: Record<string, number> = {};
  const connect = vi.fn(
    async (url: string, _h: unknown, _c: unknown, opts: { signal?: AbortSignal }) => {
      const host = new URL(url).hostname.split('.')[0] ?? '';
      calls[host] = (calls[host] ?? 0) + 1;
      const list = byHost[host];
      if (list === 'fail' || list === undefined) throw new Error('refused');
      if (list === 'hang') {
        return new Promise<McpConnection>((_, reject) => {
          opts.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        });
      }
      const conn: McpConnection = {
        listTools: async () => list,
        callTool: async () => ({ ok: true, content: 'ok' }),
        close: async () => {},
      };
      return conn;
    },
  );
  return { connect: connect as unknown as McpManagerDeps['connect'], calls };
}

async function startMock(variant: 'standard' | 'hostile' | 'hanging-list' = 'standard') {
  const mock = await startMockMcpServer({ variant });
  mocks.push(mock);
  return mock;
}

test('a hostile output schema is never compiled or run', async () => {
  const mock = await startMock('hostile');
  addServer('hostile', mock.url);
  const started = Date.now();
  const evil = (await manager().toolsFor(auth)).find((d) => d.name === 'mcp_hostile_evil');
  expect(evil).toBeDefined();
  const signal = new AbortController().signal;
  const result = await evil?.execute({}, { signal, log: t.c.log } as never);
  expect(result).toEqual({ ok: true, content: 'done' });
  expect(Date.now() - started).toBeLessThan(1000);
});

test('test() ends within its time limit when tools/list hangs', async () => {
  const mock = await startMock('hanging-list');
  const server = addServer('hang', mock.url);
  const started = Date.now();
  const result = await manager({ testTimeoutMs: 300 }).test(auth, server.id);
  expect(result).toMatchObject({ ok: false });
  expect(Date.now() - started).toBeLessThan(2000);
});

test('community members never reach private addresses, even if one was stored', async () => {
  const mock = await startMock();
  const member = await addUser(t, 'sinta');
  addServer('local', mock.url, member.auth);
  t.c.instance.set('mode', 'community');
  await expect(manager().toolsFor(member.auth)).resolves.toEqual([]);
  expect(mock.requestCount()).toBe(0);
});

test('a turn gets at most 64 MCP tools, by server name then tool name', async () => {
  const many = (prefix: string) =>
    tools(...Array.from({ length: 40 }, (_, i) => `${prefix}${String(39 - i).padStart(2, '0')}`));
  addServer('beta');
  addServer('alpha');
  const log = spyLog();
  const { connect } = fakeConnect({ alpha: many('a'), beta: many('b') });
  const m = manager({ connect, log: log as never });
  const names = (await m.toolsFor(auth)).map((d) => d.name);
  expect(names).toHaveLength(MCP_TURN_MAX_TOOLS);
  expect(names[0]).toBe('mcp_alpha_a00');
  expect(names[39]).toBe('mcp_alpha_a39');
  expect(names[40]).toBe('mcp_beta_b00');
  expect(names.at(-1)).toBe('mcp_beta_b23');
  expect(log.warn).toHaveBeenCalledWith({ dropped: 16 }, expect.any(String));
  await m.toolsFor(auth);
  expect(log.warn).toHaveBeenCalledTimes(1);
});

test('a failing server is not tried again for 60 s', async () => {
  addServer('down');
  const { connect, calls } = fakeConnect({ down: 'fail' });
  const m = manager({ connect });
  expect(await m.toolsFor(auth)).toEqual([]);
  expect(calls.down).toBe(1);
  t.clock.advance(MCP_RETRY_AFTER_MS - 1);
  expect(await m.toolsFor(auth)).toEqual([]);
  expect(calls.down).toBe(1);
  t.clock.advance(1);
  await m.toolsFor(auth);
  expect(calls.down).toBe(2);
});

test('a server that missed the cold deadline is not waited on again for 60 s', async () => {
  addServer('slow');
  const { connect, calls } = fakeConnect({ slow: 'hang' });
  const m = manager({ connect });
  await m.toolsFor(auth);
  const started = Date.now();
  expect(await m.toolsFor(auth)).toEqual([]);
  expect(Date.now() - started).toBeLessThan(MCP_LIST_WAIT_MS / 4);
  expect(calls.slow).toBe(1);
});

test('tool names that collide after sanitizing are logged and dropped', async () => {
  const server = addServer('dup');
  const log = spyLog();
  const { connect } = fakeConnect({ dup: tools('a.b', 'a_b', 'c') });
  const m = manager({ connect, log: log as never });
  const names = (await m.toolsFor(auth)).map((d) => d.name);
  expect(names).toEqual(['mcp_dup_a_b', 'mcp_dup_c']);
  expect(log.warn).toHaveBeenCalledWith({ mcpServer: server.id, dropped: 1 }, expect.any(String));
  expect(JSON.stringify(log.warn.mock.calls)).not.toContain('a.b');
  await m.toolsFor(auth);
  expect(log.warn).toHaveBeenCalledTimes(1);
});

test('test() caps tool names at 64 characters', async () => {
  const server = addServer('long');
  const { connect } = fakeConnect({ long: tools('x'.repeat(200)) });
  const result = await manager({ connect }).test(auth, server.id);
  expect(result.ok && result.tools[0]?.name).toBe('x'.repeat(64));
});
