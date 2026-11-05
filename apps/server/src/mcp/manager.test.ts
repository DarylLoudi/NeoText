import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  BIG_RESULT_CHARS,
  type MockMcpServer,
  startMockMcpServer,
} from '../../test-support/mock-mcp-server';
import {
  authContextFor,
  authed,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';
import {
  callStep,
  lastMessages,
  run,
  SUFFIX,
  stop,
  text,
  toolParts,
} from '../../test-support/tool-harness';
import { TOOL_RESULT_MAX } from '../chat/generation/tool-loop';
import type { AuthContext } from '../http/env';
import { createSemaphore } from '../lib/semaphore';
import type { ChatRequest } from '../providers/types';
import type { ToolContext, ToolDefinition } from '../tools/types';
import { MCP_LIST_WAIT_MS, MCP_TOOLS_TTL_MS } from './manager';

let t: TestApp;
let mcp: MockMcpServer;
let auth: AuthContext;
let api: ReturnType<typeof authed>;
beforeEach(async () => {
  t = await createTestApp();
  mcp = await startMockMcpServer();
  const owner = await setupOwner(t);
  auth = authContextFor(t, owner.cookie);
  api = authed(t, owner.cookie);
});
afterEach(async () => {
  await t.close();
  await mcp.close();
});

async function addServer(body: Record<string, unknown>): Promise<string> {
  const res = await api('/api/mcp-servers', { method: 'POST', body: JSON.stringify(body) });
  if (res.status !== 201) throw new Error(`addServer failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { server: { id: string } }).server.id;
}

const ctx = (signal = new AbortController().signal): ToolContext => ({
  userId: auth.userId,
  timeZone: 'UTC',
  signal,
  http: {} as never,
  log: t.c.log,
  fetchSlots: createSemaphore(4),
});

async function toolNamed(name: string): Promise<ToolDefinition> {
  const def = (await t.c.mcp.toolsFor(auth)).find((d) => d.name === name);
  if (!def) throw new Error(`no tool ${name}`);
  return def;
}

/** A server that accepts connections and never answers. */
async function startSilentServer() {
  const server = http.createServer(() => {});
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test('a remote tool name reaches the client safe and bounded', async () => {
  const hostile = await startMockMcpServer({ variant: 'hostile-name' });
  try {
    await addServer({ name: 'files', url: hostile.url });
    const [tool] = await t.c.mcp.toolsFor(auth);
    expect(tool?.mcp?.server).toBe('files');
    expect(tool?.mcp?.tool).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
  } finally {
    await hostile.close();
  }
});

test('lists and calls tools', async () => {
  await addServer({ name: 'test', url: mcp.url });
  const tools = await t.c.mcp.toolsFor(auth);
  const echo = tools.find((d) => d.name === 'mcp_test_echo');
  expect(echo).toMatchObject({ source: 'mcp', defaultPolicy: 'ask' });
  expect(echo?.description).toBe('Echo the text back.');
  expect(echo?.parameters).toMatchObject({ type: 'object', properties: { text: {} } });
  const result = await echo?.execute({ text: 'hi' }, ctx());
  expect(result).toMatchObject({ ok: true });
  expect(result?.ok && result.content).toContain('hi');
});

test('isError becomes a failed result', async () => {
  await addServer({ name: 'test', url: mcp.url });
  const fail = await toolNamed('mcp_test_fail');
  expect(await fail.execute({}, ctx())).toEqual({ ok: false, error: 'the widget is broken' });
});

test('only text content reaches the model', async () => {
  await addServer({ name: 'test', url: mcp.url });
  const mixed = await toolNamed('mcp_test_mixed');
  expect(await mixed.execute({}, ctx())).toEqual({
    ok: true,
    content: 'see picture\n[non-text content omitted]',
  });
});

test('slow tool times out', async () => {
  await addServer({ name: 'test', url: mcp.url });
  const slow = { ...(await toolNamed('mcp_test_slow')), timeoutMs: 200 };
  const r = await run([callStep('c1', 'mcp_test_slow', '{}'), [text('ok'), stop]], [slow], {
    policies: { mcp_test_slow: 'auto' },
  });
  expect(toolParts(r.final)[0]).toMatchObject({ status: 'error' });
  const tail = lastMessages(r.requests[1] as ChatRequest, 1)[0] as { content: string };
  expect(tail.content).toContain('did not answer');
  expect(r.final.status).toBe('complete');
});

test('big result is truncated', async () => {
  await addServer({ name: 'test', url: mcp.url });
  const big = await toolNamed('mcp_test_big');
  const direct = await big.execute({}, ctx());
  expect(direct.ok && direct.content.length).toBe(BIG_RESULT_CHARS);
  const r = await run([callStep('c1', 'mcp_test_big', '{}'), [text('ok'), stop]], [big], {
    policies: { mcp_test_big: 'auto' },
  });
  const toolMsg = lastMessages(r.requests[1] as ChatRequest, 1)[0] as { content: string };
  expect(toolMsg.content).toHaveLength(TOOL_RESULT_MAX + SUFFIX.length);
  expect(toolMsg.content.endsWith(SUFFIX)).toBe(true);
});

test('a dead server is skipped, turn proceeds', async () => {
  const dead = await startMockMcpServer();
  const url = dead.url;
  await dead.close();
  await addServer({ name: 'dead', url });
  const started = Date.now();
  await expect(t.c.mcp.toolsFor(auth)).resolves.toEqual([]);
  expect(Date.now() - started).toBeLessThan(MCP_LIST_WAIT_MS + 500);
});

test('a silent server is skipped after the wait while the others are offered', async () => {
  const silent = await startSilentServer();
  try {
    await addServer({ name: 'test', url: mcp.url });
    await addServer({ name: 'silent', url: silent.url });
    const started = Date.now();
    const names = (await t.c.tools.forTurn(auth, { userText: 'hi', webSearch: false })).map(
      (d) => d.name,
    );
    expect(Date.now() - started).toBeLessThan(MCP_LIST_WAIT_MS + 500);
    expect(names).toContain('mcp_test_echo');
    expect(names.some((n) => n.startsWith('mcp_silent'))).toBe(false);
  } finally {
    await t.c.mcp.closeAll();
    await silent.close();
  }
});

test('tool list is cached', async () => {
  await addServer({ name: 'test', url: mcp.url });
  await t.c.mcp.toolsFor(auth);
  const after = mcp.requestCount();
  const again = await t.c.mcp.toolsFor(auth);
  expect(again.map((d) => d.name)).toContain('mcp_test_echo');
  expect(mcp.requestCount()).toBe(after);
});

test('a stale list is served at once and refreshed in the background', async () => {
  await addServer({ name: 'test', url: mcp.url });
  await t.c.mcp.toolsFor(auth);
  const after = mcp.requestCount();
  t.clock.advance(MCP_TOOLS_TTL_MS + 1);
  const stale = await t.c.mcp.toolsFor(auth);
  expect(stale.map((d) => d.name)).toContain('mcp_test_echo');
  await vi.waitFor(() => expect(mcp.requestCount()).toBeGreaterThan(after));
});

test('disabled and changed servers are not served from the cache', async () => {
  const id = await addServer({ name: 'test', url: mcp.url });
  expect(await t.c.mcp.toolsFor(auth)).not.toEqual([]);
  await api(`/api/mcp-servers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled: false }),
  });
  expect(await t.c.mcp.toolsFor(auth)).toEqual([]);
  await api(`/api/mcp-servers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled: true, name: 'other' }),
  });
  const names = (await t.c.mcp.toolsFor(auth)).map((d) => d.name);
  expect(names).toContain('mcp_other_echo');
  expect(names).not.toContain('mcp_test_echo');
});

test('a call after closeAll reconnects', async () => {
  await addServer({ name: 'test', url: mcp.url });
  const echo = await toolNamed('mcp_test_echo');
  await t.c.mcp.closeAll();
  expect(await echo.execute({ text: 'again' }, ctx())).toEqual({
    ok: true,
    content: 'echo: again',
  });
});
