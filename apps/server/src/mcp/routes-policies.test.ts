import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { type MockMcpServer, startMockMcpServer } from '../../test-support/mock-mcp-server';
import {
  authContextFor,
  authed,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';
import type { AuthContext } from '../http/env';

/** "Always allow" is keyed by tool name, so it must not outlive the server it was given to. */
let t: TestApp;
let mcp: MockMcpServer;
let api: ReturnType<typeof authed>;
let auth: AuthContext;
beforeEach(async () => {
  t = await createTestApp();
  mcp = await startMockMcpServer();
  const owner = await setupOwner(t);
  api = authed(t, owner.cookie);
  auth = authContextFor(t, owner.cookie);
});
afterEach(async () => {
  await t.close();
  await mcp.close();
});

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });

async function addServer(name: string): Promise<string> {
  const res = await api('/api/mcp-servers', json('POST', { name, url: mcp.url }));
  expect(res.status).toBe(201);
  return ((await res.json()) as { server: { id: string } }).server.id;
}

const SIBLINGS = {
  mcp_my_files2_read: 'auto',
  mcp_other_read: 'auto',
  fetch_url: 'ask',
} as const;

function seedPolicies() {
  t.c.settings.patch(auth.userId, auth.dek, {
    chat: { temperature: 0.4 },
    tools: {
      maxSteps: 5,
      policies: { mcp_my_files_read: 'auto', mcp_my_files_write: 'off', ...SIBLINGS },
    },
  });
}
const settings = () => t.c.settings.get(auth.userId, auth.dek).settings;

test('deleting a server forgets its tool policies and keeps every other setting', async () => {
  const id = await addServer('my files');
  seedPolicies();
  expect((await api(`/api/mcp-servers/${id}`, { method: 'DELETE' })).status).toBe(204);
  expect(settings().tools.policies).toEqual(SIBLINGS);
  expect(settings().tools.maxSteps).toBe(5);
  expect(settings().chat.temperature).toBe(0.4);
  // A new server with the old name starts with no "always allow".
  await addServer('my files');
  expect(settings().tools.policies).toEqual(SIBLINGS);
});

test('renaming a server or changing its URL forgets the old policies', async () => {
  const id = await addServer('my files');
  seedPolicies();
  const renamed = await api(`/api/mcp-servers/${id}`, json('PATCH', { name: 'archive' }));
  expect(renamed.status).toBe(200);
  expect(settings().tools.policies).toEqual(SIBLINGS);

  t.c.settings.patch(auth.userId, auth.dek, { tools: { policies: { mcp_archive_read: 'auto' } } });
  const moved = await api(`/api/mcp-servers/${id}`, json('PATCH', { url: `${mcp.url}?v=2` }));
  expect(moved.status).toBe(200);
  expect(settings().tools.policies).toEqual(SIBLINGS);
  expect(settings().chat.temperature).toBe(0.4);
});

test('other edits keep the policies', async () => {
  const id = await addServer('my files');
  seedPolicies();
  const same = { name: 'my files', url: mcp.url, enabled: false };
  expect((await api(`/api/mcp-servers/${id}`, json('PATCH', same))).status).toBe(200);
  expect(settings().tools.policies).toMatchObject({ mcp_my_files_read: 'auto' });
});

const policies = () => settings().tools.policies;
const setPolicies = (p: Record<string, string>) =>
  t.c.settings.patch(auth.userId, auth.dek, { tools: { policies: p } });
const ENTERPRISE = { mcp_github_enterprise_echo: 'auto', mcp_github_enterprise_x: 'off' } as const;

test('deleting "github" keeps every policy of "github_enterprise" (no tool list known)', async () => {
  const github = await addServer('github');
  await addServer('github_enterprise');
  setPolicies({ mcp_github_echo: 'auto', ...ENTERPRISE });
  expect((await api(`/api/mcp-servers/${github}`, { method: 'DELETE' })).status).toBe(204);
  expect(policies()).toEqual(ENTERPRISE);
});

test('with a known tool list, only those exact tool names are forgotten', async () => {
  const github = await addServer('github');
  await addServer('github_enterprise');
  // Lists both servers' tools (echo, slow, big, fail, mixed), so the manager knows them.
  await t.c.mcp.toolsFor(auth);
  const unlisted = { mcp_github_unlisted: 'auto' } as const;
  setPolicies({ mcp_github_echo: 'auto', mcp_github_fail: 'off', ...unlisted, ...ENTERPRISE });
  expect((await api(`/api/mcp-servers/${github}`, { method: 'DELETE' })).status).toBe(204);
  expect(policies()).toEqual({ ...unlisted, ...ENTERPRISE });
});

test('renaming to a name with the same tool prefix and the same URL keeps the policies', async () => {
  const id = await addServer('my files');
  setPolicies({ mcp_my_files_read: 'auto' });
  const res = await api(`/api/mcp-servers/${id}`, json('PATCH', { name: 'my_files' }));
  expect(res.status).toBe(200);
  expect(policies()).toEqual({ mcp_my_files_read: 'auto' });
});

test('adding a server clears policies left from an earlier server of that name only', async () => {
  await addServer('github_enterprise');
  setPolicies({ mcp_github_stale: 'auto', ...ENTERPRISE, fetch_url: 'ask' });
  await addServer('github');
  expect(policies()).toEqual({ ...ENTERPRISE, fetch_url: 'ask' });
});

test('a delete still succeeds when forgetting the policies fails, and logs no names', async () => {
  const id = await addServer('github');
  setPolicies({ mcp_github_echo: 'auto' });
  const patch = vi.spyOn(t.c.settings, 'patch').mockImplementation(() => {
    throw new Error('disk full for mcp_github_echo');
  });
  const logged = vi.spyOn(t.c.log, 'error');
  try {
    expect((await api(`/api/mcp-servers/${id}`, { method: 'DELETE' })).status).toBe(204);
  } finally {
    patch.mockRestore();
  }
  expect(logged).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(logged.mock.calls)).not.toContain('mcp_github');
  expect((await (await api('/api/mcp-servers')).json()) as unknown).toEqual({ servers: [] });
});
