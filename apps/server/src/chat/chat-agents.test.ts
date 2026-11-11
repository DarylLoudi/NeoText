import type { AgentData, ConversationDetail, StreamEvent } from '@neotext/shared';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { type MockProvider, startMockProvider } from '../../test-support/mock-provider';
import { readEvents } from '../../test-support/sse-client';
import { textFrames } from '../../test-support/sse-frames';
import {
  addUser,
  authed,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';

let t: TestApp;
let mock: MockProvider;
let api: ReturnType<typeof authed>;
let providerId: string;

beforeEach(async () => {
  t = await createTestApp();
  mock = await startMockProvider();
  mock.models = ['m1', 'm2'];
  api = authed(t, (await setupOwner(t)).cookie);
  const res = await api('/api/providers', {
    method: 'POST',
    body: JSON.stringify({ kind: 'openai-compatible', name: 'Mock', baseUrl: mock.url }),
  });
  providerId = ((await res.json()) as { provider: { id: string } }).provider.id;
  await api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({
      // Delegation off, so the system message and tool list hold only what the agent sets.
      patch: {
        chat: { includeDate: false, defaultSystemPrompt: 'DEFAULT' },
        tools: { policies: { delegate_tasks: 'off' } },
      },
    }),
  });
});
afterEach(async () => {
  await t.close();
  await mock.close();
});

const makeAgent = async (over: Partial<AgentData> = {}, as: typeof api = api) =>
  (await (
    await as('/api/agents', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Helper',
        data: { instructions: 'BE BRIEF', ...over },
      }),
    })
  ).json()) as { id: string };
const turn = (agentId: string, over: Record<string, unknown> = {}) => ({
  conversationId: null,
  parentId: null,
  userMessage: { text: 'baca https://x.org' },
  targets: [{ providerId, modelId: 'm1' }],
  options: { agentId },
  ...over,
});
type Sent = {
  model: string;
  messages: { role: string; content: string }[];
  tools?: { function: { name: string } }[];
};
const send = async (body: unknown) => {
  mock.requests.length = 0;
  mock.enqueue({ frames: textFrames('ok') });
  const res = await api('/api/chat', { method: 'POST', body: JSON.stringify(body) });
  if (res.status !== 200) return { res, evs: [] as StreamEvent[], sent: null };
  const evs = await readEvents(res);
  const sent = mock.requests.find((r) => r.path === '/v1/chat/completions')?.body as Sent;
  return { res, evs, sent };
};
const conversationOf = (evs: StreamEvent[]) =>
  (evs.find((e) => e.type === 'generation.started') as { conversationId: string }).conversationId;
const detail = async (id: string) =>
  (await (await api(`/api/conversations/${id}`)).json()) as ConversationDetail;

test('the agent instructions replace the default prompt; its model replaces the target', async () => {
  const agent = await makeAgent({ model: { providerId, modelId: 'm2' } });
  const { sent } = await send(turn(agent.id));
  expect(sent?.messages[0]).toEqual({ role: 'system', content: 'BE BRIEF' });
  expect(sent?.model).toBe('m2');
});

test('the date line stays after the instructions', async () => {
  await api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({ patch: { chat: { includeDate: true } } }),
  });
  const agent = await makeAgent();
  const { sent } = await send(turn(agent.id));
  expect(sent?.messages[0]?.content.startsWith('BE BRIEF\n\n')).toBe(true);
  expect(sent?.messages[0]?.content).not.toContain('DEFAULT');
});

test('fetch_url is absent when the agent turns it off, present otherwise', async () => {
  const off = await makeAgent({ tools: { webSearch: true, fetchUrl: false } });
  const offNames = (await send(turn(off.id))).sent?.tools?.map((x) => x.function.name);
  expect(offNames).not.toContain('fetch_url');
  const on = await makeAgent();
  const names = (await send(turn(on.id))).sent?.tools?.map((x) => x.function.name);
  expect(names).toContain('fetch_url');
});

test('the answer starts with the agent part, in the final message and when stored', async () => {
  const agent = await makeAgent();
  const { evs } = await send(turn(agent.id));
  const started = evs.find((e) => e.type === 'generation.finished') as unknown as {
    message: { parts: unknown[] };
  };
  expect(started.message.parts[0]).toEqual({ type: 'agent', agentId: agent.id, name: 'Helper' });
  const assistant = (await detail(conversationOf(evs))).messages.find(
    (m) => m.role === 'assistant',
  );
  expect(assistant?.parts[0]).toEqual({ type: 'agent', agentId: agent.id, name: 'Helper' });
  expect(assistant?.parts.some((p) => p.type === 'text')).toBe(true);
});

test('unknown, disabled and foreign agents give 404', async () => {
  expect((await send(turn('agt_nope'))).res.status).toBe(404);
  const off = await makeAgent({ enabled: false });
  const res = (await send(turn(off.id))).res;
  expect(res.status).toBe(404);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe('agent_not_found');
  const other = await addUser(t, 'other@example.com');
  const theirs = await makeAgent({}, authed(t, other.cookie));
  expect((await send(turn(theirs.id))).res.status).toBe(404);
});

test('two targets give 400 agent_single_target', async () => {
  const agent = await makeAgent();
  const { res } = await send(
    turn(agent.id, {
      targets: [
        { providerId, modelId: 'm1' },
        { providerId, modelId: 'm2' },
      ],
    }),
  );
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
    'agent_single_target',
  );
});

test('a model on a missing provider gives 400 agent_model_unavailable', async () => {
  const agent = await makeAgent({ model: { providerId: 'prv_gone', modelId: 'x' } });
  const { res } = await send(turn(agent.id));
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
    'agent_model_unavailable',
  );
});

// A regenerate of an agent answer keeps the agent because the client sends `agentId` again.
test('history sent to the model contains no agent part', async () => {
  const agent = await makeAgent();
  const first = await send(turn(agent.id, { userMessage: { text: 'one' } }));
  const cid = conversationOf(first.evs);
  const d = await detail(cid);
  const assistant = d.messages.find((m) => m.role === 'assistant');
  const { sent } = await send(
    turn(agent.id, {
      conversationId: cid,
      parentId: assistant?.id,
      userMessage: { text: 'two' },
    }),
  );
  const roles = sent?.messages.map((m) => m.role);
  expect(roles).toEqual(['system', 'user', 'assistant', 'user']);
  expect(JSON.stringify(sent?.messages)).not.toContain('agentId');
});

test("an agent's own model answers once; the chat keeps the model the user picked", async () => {
  const agent = await makeAgent({ model: { providerId, modelId: 'm2' } });
  const { evs, sent } = await send(turn(agent.id));
  expect(sent?.model).toBe('m2');
  const d = await detail(conversationOf(evs));
  expect(d.conversation.modelRef).toEqual({ providerId, modelId: 'm1' });
  expect(d.messages.find((m) => m.role === 'assistant')?.model).toEqual({
    providerId,
    modelId: 'm2',
  });
});

test('a regenerate or an edit of an answer whose agent is gone answers plainly', async () => {
  const agent = await makeAgent();
  const first = await send(turn(agent.id, { userMessage: { text: 'one' } }));
  const cid = conversationOf(first.evs);
  const user = (await detail(cid)).messages.find((m) => m.role === 'user');
  await api(`/api/agents/${agent.id}`, { method: 'DELETE' });

  const regen = await send(
    turn(agent.id, { conversationId: cid, parentId: user?.id, userMessage: null }),
  );
  expect(regen.res.status).toBe(200);
  expect(regen.sent?.messages[0]).toEqual({ role: 'system', content: 'DEFAULT' });
  const fin = regen.evs.find((e) => e.type === 'generation.finished') as unknown as {
    message: { parts: { type: string }[] };
  };
  expect(fin.message.parts.some((p) => p.type === 'agent')).toBe(false);

  // An edit: a new user message beside the first one.
  const edit = await send(
    turn(agent.id, { conversationId: cid, parentId: null, userMessage: { text: 'uno' } }),
  );
  expect(edit.res.status).toBe(200);

  // A new message to the agent that is gone is still refused.
  const leaf = (await detail(cid)).conversation.activeLeafId;
  const fresh = await send(
    turn(agent.id, { conversationId: cid, parentId: leaf, userMessage: { text: 'three' } }),
  );
  expect(fresh.res.status).toBe(404);
});
