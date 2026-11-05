import type { AgentData, AgentPublic } from '@neotext/shared';
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  addUser,
  authContextFor,
  authed,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';
import { aad } from '../crypto/aad';
import { openJson, openText } from '../crypto/aead';

let t: TestApp;
let api: ReturnType<typeof authed>;
let cookie: string;

const data = (over: Partial<AgentData> = {}) => ({ instructions: 'Be thorough.', ...over });
const create = (name = 'Researcher', over: Partial<AgentData> = {}) =>
  api('/api/agents', { method: 'POST', body: JSON.stringify({ name, data: data(over) }) });
const listOf = async (a: typeof api) =>
  ((await (await a('/api/agents')).json()) as { agents: AgentPublic[] }).agents;

beforeEach(async () => {
  t = await createTestApp();
  cookie = (await setupOwner(t)).cookie;
  api = authed(t, cookie);
});
afterEach(() => t.close());

test('create fills defaults, then list, update and delete work', async () => {
  const res = await create('B');
  expect(res.status).toBe(201);
  const b = (await res.json()) as AgentPublic;
  expect(b.data).toMatchObject({
    description: '',
    model: null,
    tools: { webSearch: true, fetchUrl: true },
    autoDelegate: false,
    enabled: true,
  });
  await create('A');
  expect((await listOf(api)).map((a) => a.name)).toEqual(['B', 'A']);
  const patched = await api(`/api/agents/${b.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'B2', data: data({ autoDelegate: true }) }),
  });
  expect(patched.status).toBe(204);
  const [first] = await listOf(api);
  expect(first).toMatchObject({ name: 'B2', data: { autoDelegate: true } });
  expect((await api(`/api/agents/${b.id}`, { method: 'DELETE' })).status).toBe(204);
  expect(await listOf(api)).toHaveLength(1);
});

test('service get and list are scoped to the user', async () => {
  const agent = (await (await create()).json()) as AgentPublic;
  const auth = authContextFor(t, cookie);
  expect(t.c.agents.get(auth, agent.id)?.name).toBe('Researcher');
  expect(t.c.agents.list(auth)).toHaveLength(1);
  const other = authContextFor(t, (await addUser(t, 'mira')).cookie);
  expect(t.c.agents.get(other, agent.id)).toBeNull();
  expect(t.c.agents.list(other)).toEqual([]);
});

test('rejects blank names and instructions over 50,000 characters', async () => {
  expect((await create('  ')).status).toBe(400);
  expect((await create('x', { instructions: 'x'.repeat(50_001) })).status).toBe(400);
  expect((await create('x', { instructions: 'x'.repeat(50_000) })).status).toBe(201);
});

test('seals the name and data', async () => {
  const agent = (await (
    await create('Secret name', { instructions: 'Secret prompt' })
  ).json()) as AgentPublic;
  const row = t.c.db.raw.prepare('SELECT name, data FROM agents WHERE id = ?').get(agent.id) as {
    name: Buffer;
    data: Buffer;
  };
  expect(row.name.toString('utf8')).not.toContain('Secret');
  expect(row.data.toString('utf8')).not.toContain('Secret');
  const { dek } = authContextFor(t, cookie);
  expect(openText(dek, row.name, aad('agents', 'name', agent.id))).toBe('Secret name');
  expect(openJson<AgentData>(dek, row.data, aad('agents', 'data', agent.id)).instructions).toBe(
    'Secret prompt',
  );
});

test("another user's agent gives 404", async () => {
  const agent = (await (await create()).json()) as AgentPublic;
  const other = authed(t, (await addUser(t, 'mira')).cookie);
  expect(await listOf(other)).toEqual([]);
  const patch = await other(`/api/agents/${agent.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'x' }),
  });
  expect(patch.status).toBe(404);
  expect((await other(`/api/agents/${agent.id}`, { method: 'DELETE' })).status).toBe(404);
  expect(await listOf(api)).toHaveLength(1);
});

test('limits each user to 50 agents', async () => {
  for (let i = 0; i < 50; i++) expect((await create(`a${i}`)).status).toBe(201);
  const res = await create('one too many');
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe('agent_limit');
});

test('agents routes require sign-in', async () => {
  expect((await t.app.request('/api/agents')).status).toBe(401);
});

test('names are unique per user, ignoring case; another user may reuse one', async () => {
  expect((await create('Scout')).status).toBe(201);
  const dup = await create(' scout ');
  expect(dup.status).toBe(409);
  expect(((await dup.json()) as { error: { code: string } }).error.code).toBe('agent_name_taken');
  const other = (await (await create('Other')).json()) as AgentPublic;
  const rename = await api(`/api/agents/${other.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'SCOUT' }),
  });
  expect(rename.status).toBe(409);
  // Renaming an agent to its own name in another case is fine.
  const self = await api(`/api/agents/${other.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'OTHER' }),
  });
  expect(self.status).toBe(204);
  const theirs = authed(t, (await addUser(t, 'x@example.com')).cookie);
  const res = await theirs('/api/agents', {
    method: 'POST',
    body: JSON.stringify({ name: 'Scout', data: data() }),
  });
  expect(res.status).toBe(201);
});

test('names lose control characters and line breaks; a long position is refused', async () => {
  const a = (await (await create('Line\none\u0007 two')).json()) as AgentPublic;
  expect(a.name).toBe('Line one two');
  const res = await api(`/api/agents/${a.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ position: 'x'.repeat(33) }),
  });
  expect(res.status).toBe(400);
});
