import {
  type ConversationDetail,
  type MessagePublic,
  type StreamEvent,
  siblingsOf,
} from '@neotext/shared';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { type MockProvider, startMockProvider } from '../../test-support/mock-provider';
import { readEvents } from '../../test-support/sse-client';
import { chunk, DONE, finish, textFrames } from '../../test-support/sse-frames';
import { authed, createTestApp, setupOwner, type TestApp } from '../../test-support/test-app';

type Started = Extract<StreamEvent, { type: 'generation.started' }>;
type Finished = Extract<StreamEvent, { type: 'generation.finished' }>;

let t: TestApp;
let mock: MockProvider;
let api: ReturnType<typeof authed>;
let userId: string;
let providerId: string;

const waitFor = async (check: () => boolean | Promise<boolean>, timeoutMs = 5000) => {
  const until = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > until) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

const activeCount = () => t.c.generations.active(userId).length;

beforeEach(async () => {
  t = await createTestApp();
  mock = await startMockProvider();
  mock.models = ['m1', 'm2'];
  const owner = await setupOwner(t);
  userId = owner.user.id;
  api = authed(t, owner.cookie);
  const res = await api('/api/providers', {
    method: 'POST',
    body: JSON.stringify({ kind: 'openai-compatible', name: 'Mock', baseUrl: mock.url }),
  });
  providerId = ((await res.json()) as { provider: { id: string } }).provider.id;
});
afterEach(async () => {
  for (const g of t.c.generations.active(userId)) t.c.generations.abort(userId, g.id);
  await waitFor(() => activeCount() === 0);
  await t.close();
  await mock.close();
});

const chat = (body: unknown, headers: Record<string, string> = {}) =>
  api('/api/chat', { method: 'POST', body: JSON.stringify(body), headers });
const get = (path: string) => api(path);
const detail = async (id: string) =>
  (await (await get(`/api/conversations/${id}`)).json()) as ConversationDetail;
const textOf = (m: MessagePublic) =>
  m.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('');
const startedOf = (evs: StreamEvent[]) =>
  evs.filter((e): e is Started => e.type === 'generation.started');
const finishedOf = (evs: StreamEvent[]) =>
  evs.filter((e): e is Finished => e.type === 'generation.finished');
const turn = (over: Record<string, unknown> = {}) => ({
  conversationId: null,
  parentId: null,
  userMessage: { text: 'Hai' },
  targets: [{ providerId, modelId: 'm1' }],
  ...over,
});
const slowFrames = () => [
  chunk({ content: 'a' }),
  { delayMs: 200 },
  chunk({ content: 'b' }),
  finish('stop'),
  DONE,
];

/** Runs one complete turn and returns its started and finished events. */
async function firstTurn() {
  mock.enqueue({ frames: textFrames('Halo!') });
  const evs = await readEvents(await chat(turn()));
  const started = startedOf(evs)[0] as Started;
  const finished = finishedOf(evs)[0] as Finished;
  return { started, finished, conversationId: started.conversationId };
}

test('new conversation turn streams and persists', async () => {
  mock.enqueue({ frames: textFrames('Halo! ', 'Apa kabar?') });
  const res = await chat(turn());
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
  expect(res.headers.get('x-accel-buffering')).toBe('no');
  const evs = await readEvents(res);
  expect(evs[0]).toMatchObject({
    type: 'generation.started',
    seq: 1,
    userMessage: { role: 'user' },
    assistantMessage: { role: 'assistant', status: 'streaming' },
    contextTrimmed: 0,
  });
  const fin = finishedOf(evs)[0] as Finished;
  expect(fin.message.status).toBe('complete');
  expect(textOf(fin.message)).toBe('Halo! Apa kabar?');
  const d = await detail((evs[0] as Started).conversationId);
  expect(d.messages).toHaveLength(2);
  expect(d.conversation.activeLeafId).toBe(fin.message.id);
  expect(d.conversation.messageCount).toBe(2);
  const sent = mock.requests.find((r) => r.path === '/v1/chat/completions');
  const body = sent?.body as { messages: { role: string; content: string }[]; user?: string };
  expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'Hai' });
  expect(body.messages[0]?.role).toBe('system');
});

test('regenerate adds an assistant sibling', async () => {
  const { started, finished, conversationId } = await firstTurn();
  mock.enqueue({ frames: textFrames('Lagi') });
  const userId = started.userMessage?.id as string;
  const evs = await readEvents(
    await chat(turn({ conversationId, parentId: userId, userMessage: null })),
  );
  const again = startedOf(evs)[0] as Started;
  expect(again.userMessage).toBeNull();
  expect(again.assistantMessage.parentId).toBe(userId);
  const d = await detail(conversationId);
  expect(d.messages).toHaveLength(3);
  const { siblings } = siblingsOf(d.messages, again.assistantMessage.id);
  expect(siblings.map((m) => m.id)).toEqual([finished.message.id, again.assistantMessage.id]);
  expect(d.conversation.activeLeafId).toBe(again.assistantMessage.id);
});

test('editing creates a new root branch', async () => {
  const { conversationId } = await firstTurn();
  mock.enqueue({ frames: textFrames('Oke') });
  await readEvents(await chat(turn({ conversationId, userMessage: { text: 'Hai lagi' } })));
  const d = await detail(conversationId);
  const roots = d.messages.filter((m) => m.parentId === null);
  expect(roots).toHaveLength(2);
  expect(roots.every((m) => m.role === 'user')).toBe(true);
});

test('a follow-up sends the path as context', async () => {
  const { finished, conversationId } = await firstTurn();
  mock.enqueue({ frames: textFrames('Baik') });
  mock.requests.length = 0;
  const parentId = finished.message.id;
  await readEvents(await chat(turn({ conversationId, parentId, userMessage: { text: 'Lalu?' } })));
  const body = mock.requests[0]?.body as { messages: { role: string; content: string }[] };
  expect(body.messages.slice(1)).toEqual([
    { role: 'user', content: 'Hai' },
    { role: 'assistant', content: 'Halo!' },
    { role: 'user', content: 'Lalu?' },
  ]);
});

test('compare streams two models over one response', async () => {
  mock.enqueue({ frames: textFrames('satu') }, { frames: textFrames('dua') });
  const targets = [
    { providerId, modelId: 'm1' },
    { providerId, modelId: 'm2' },
  ];
  const evs = await readEvents(await chat(turn({ targets })));
  const started = startedOf(evs);
  expect(started).toHaveLength(2);
  expect(new Set(started.map((e) => e.generationId)).size).toBe(2);
  expect(started.map((e) => e.seq)).toEqual([1, 1]);
  expect(started[0]?.userMessage?.role).toBe('user');
  expect(started[1]?.userMessage).toBeNull();
  const finished = finishedOf(evs);
  expect(finished).toHaveLength(2);
  expect(finished.every((e) => e.message.status === 'complete')).toBe(true);
  const parents = new Set(finished.map((e) => e.message.parentId));
  expect(parents).toEqual(new Set([started[0]?.userMessage?.id]));
  expect(new Set(finished.map((e) => e.message.createdAt)).size).toBe(1);
  expect(finished.map((e) => e.message.model?.modelId).sort()).toEqual(['m1', 'm2']);
});

test('generation continues after the client disconnects', async () => {
  mock.enqueue({ frames: slowFrames() });
  const res = await chat(turn());
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  await reader.cancel();
  const conversationId = (JSON.parse(first.slice('data: '.length)) as Started).conversationId;
  await waitFor(async () => {
    const body = (await (await get('/api/generations/active')).json()) as { items: unknown[] };
    return body.items.length === 0;
  });
  const assistant = (await detail(conversationId)).messages.find((m) => m.role === 'assistant');
  expect(assistant?.status).toBe('complete');
  expect(textOf(assistant as MessagePublic)).toBe('ab');
});

test('a disconnect aborts when continueInBackground is off', async () => {
  await api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({ patch: { chat: { continueInBackground: false } } }),
  });
  mock.enqueue({ frames: slowFrames() });
  const evs = await readEvents(await chat(turn()), {
    until: (e) => e.type === 'generation.started',
  });
  const started = evs[0] as Started;
  await waitFor(() => activeCount() === 0);
  const d = await detail(started.conversationId);
  expect(d.messages.find((m) => m.role === 'assistant')?.status).toBe('aborted');
});

test('resume sends a snapshot, then the rest', async () => {
  mock.enqueue({ frames: slowFrames() });
  const evs = await readEvents(await chat(turn()), {
    until: (e) => e.type === 'generation.started',
  });
  const id = (evs[0] as Started).generationId;
  const active = (await (await get('/api/generations/active')).json()) as {
    items: { id: string }[];
  };
  expect(active.items.map((g) => g.id)).toEqual([id]);
  const resumed = await readEvents(await get(`/api/generations/${id}/stream`));
  expect(resumed[0]?.type).toBe('generation.snapshot');
  expect(resumed[0]?.seq).toBeGreaterThan(1);
  const last = resumed.find((e) => e.type === 'generation.finished') as Finished;
  expect(last.type).toBe('generation.finished');
  expect(textOf(last.message)).toBe('ab');

  const again = await readEvents(await get(`/api/generations/${id}/stream`));
  expect(again.map((e) => e.type)).toEqual(['generation.snapshot', 'generation.finished']);
  expect((await get('/api/generations/gen_unknown/stream')).status).toBe(404);
});

test('abort over HTTP', async () => {
  mock.enqueue({ frames: slowFrames() });
  const all = readEvents(await chat(turn()));
  await waitFor(() => mock.requests.some((r) => r.path === '/v1/chat/completions'));
  const [g] = t.c.generations.active(userId);
  const res = await api(`/api/generations/${g?.id}/abort`, { method: 'POST' });
  expect(res.status).toBe(204);
  const fin = finishedOf(await all)[0] as Finished;
  expect(fin.message.status).toBe('aborted');
  expect((await api('/api/generations/gen_unknown/abort', { method: 'POST' })).status).toBe(404);
});

test('same idempotency key returns the same generations', async () => {
  mock.enqueue({ frames: textFrames('sekali') });
  const headers = { 'Idempotency-Key': 'k1' };
  const one = startedOf(await readEvents(await chat(turn(), headers)));
  const twoEvs = await readEvents(await chat(turn(), headers));
  const two = startedOf(twoEvs);
  expect(two.map((e) => e.generationId)).toEqual(one.map((e) => e.generationId));
  expect(two[0]?.userMessage?.id).toBe(one[0]?.userMessage?.id);
  expect(finishedOf(twoEvs)[0]?.message.status).toBe('complete');
  const d = await detail(one[0]?.conversationId as string);
  expect(d.messages).toHaveLength(2);
  expect((await chat(turn(), { 'Idempotency-Key': 'x'.repeat(65) })).status).toBe(400);
});

test('parent must belong to the conversation', async () => {
  const a = await firstTurn();
  const b = await firstTurn();
  const res = await chat(
    turn({ conversationId: b.conversationId, parentId: a.finished.message.id }),
  );
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad_request');
  const fresh = await chat(turn({ parentId: a.finished.message.id }));
  expect(fresh.status).toBe(400);
});

test('regenerate needs a user parent', async () => {
  const { finished, conversationId } = await firstTurn();
  const res = await chat(
    turn({ conversationId, parentId: finished.message.id, userMessage: null }),
  );
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: { code: string; message: string } };
  expect(body.error).toMatchObject({
    code: 'bad_request',
    message: 'Regenerate needs the user message it answers.',
  });
});

test('unknown provider or conversation is 404', async () => {
  const res = await chat(turn({ targets: [{ providerId: 'prv_nope', modelId: 'm1' }] }));
  expect(res.status).toBe(404);
  expect((await chat(turn({ conversationId: 'cnv_nope' }))).status).toBe(404);
});

const addProvider = async (name: string) => {
  const res = await api('/api/providers', {
    method: 'POST',
    body: JSON.stringify({ kind: 'openai-compatible', name, baseUrl: mock.url }),
  });
  return ((await res.json()) as { provider: { id: string } }).provider.id;
};
const turnOff = (id: string) =>
  api(`/api/providers/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled: false }) });

test('a turned-off provider cannot be chatted with', async () => {
  await turnOff(providerId);
  const res = await chat(turn());
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: unknown }).error).toMatchObject({
    code: 'bad_request',
    message: 'That provider is turned off. Turn it on in Settings → Providers.',
  });
  expect(mock.requests.some((r) => r.path === '/v1/chat/completions')).toBe(false);
});

test('a turned-off title provider falls back to the turn model', async () => {
  const titleId = await addProvider('Titles');
  await api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({
      patch: { chat: { titleModel: { providerId: titleId, modelId: 't1' } } },
    }),
  });
  await turnOff(titleId);
  mock.enqueue({ frames: textFrames('Jawaban') }, { frames: textFrames('Judul') });
  const evs = await readEvents(await chat(turn()));
  expect(evs.at(-1)).toMatchObject({ type: 'conversation.updated', title: 'Judul' });
  const models = mock.requests
    .filter((r) => r.path === '/v1/chat/completions')
    .map((r) => (r.body as { model: string }).model);
  expect(models).toEqual(['m1', 'm1']);
});

test('more than 4 at once is refused', async () => {
  const hang = { frames: [chunk({ content: 'a' })], hangAfterFrames: true };
  mock.enqueue(hang, hang, hang, hang);
  const targets = ['m1', 'm2', 'm1', 'm2'].map((modelId) => ({ providerId, modelId }));
  let seen = 0;
  await readEvents(await chat(turn({ targets })), {
    until: (e) => e.type === 'generation.started' && ++seen === 4,
  });
  expect(activeCount()).toBe(4);
  const res = await chat(turn());
  expect(res.status).toBe(429);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe('rate_limited');
  await waitFor(() => mock.openChats() === 4);
});

test('web search adds the OpenRouter server tool', async () => {
  const created = await api('/api/providers', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'openrouter',
      name: 'OR',
      baseUrl: mock.url,
      apiKey: 'sk-or-test-1234567890',
    }),
  });
  const orId = ((await created.json()) as { provider: { id: string } }).provider.id;
  mock.enqueue({ frames: textFrames('Dicari') });
  await readEvents(
    await chat(
      turn({ targets: [{ providerId: orId, modelId: 'm1' }], options: { webSearch: true } }),
    ),
  );
  const sent = mock.requests.find((r) => r.path === '/v1/chat/completions');
  const body = sent?.body as { tools: { type: string }[]; user: string };
  expect(body.tools.map((tool) => tool.type)).toContain('openrouter:web_search');
  expect(body.user).toMatch(/^[0-9a-f]{16}$/);
});

const chatCalls = () => mock.requests.filter((r) => r.path === '/v1/chat/completions');

test('first exchange gets a title before the stream closes', async () => {
  mock.enqueue({ frames: textFrames('Jawaban') }, { frames: textFrames('Rencana skripsi') });
  const evs = await readEvents(await chat(turn()));
  const last = evs.at(-1);
  expect(last).toMatchObject({ type: 'conversation.updated', title: 'Rencana skripsi' });
  const d = await detail((evs[0] as Started).conversationId);
  expect(d.conversation.title).toBe('Rencana skripsi');
  expect(d.conversation.titleSource).toBe('auto');
  const titleReq = chatCalls()[1]?.body as { messages: { role: string }[]; max_tokens?: number };
  expect(titleReq.messages[0]?.role).toBe('system');
});

test('a failed title call falls back to the first words', async () => {
  mock.enqueue(
    { frames: textFrames('Jawaban') },
    { status: 500, body: JSON.stringify({ error: { message: 'boom' } }) },
  );
  const evs = await readEvents(await chat(turn({ userMessage: { text: 'Halo dunia' } })));
  expect(evs.at(-1)).toMatchObject({ type: 'conversation.updated', title: 'Halo dunia' });
  const d = await detail((evs[0] as Started).conversationId);
  expect(d.conversation.titleSource).toBe('auto');
});

test('no title is generated when autoTitle is off', async () => {
  const res = await api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({ patch: { chat: { autoTitle: false } } }),
  });
  expect(res.status).toBe(200);
  mock.enqueue({ frames: textFrames('Jawaban') });
  const evs = await readEvents(await chat(turn()));
  expect(evs.some((e) => e.type === 'conversation.updated')).toBe(false);
  expect(chatCalls()).toHaveLength(1);
});

test('shutdown during a slow title call writes nothing afterwards', async () => {
  mock.enqueue(
    { frames: textFrames('Jawaban') },
    { frames: [{ delayMs: 1500 }, ...textFrames('Judul')] },
  );
  const res = await chat(turn());
  const events = readEvents(res);
  await waitFor(() => chatCalls().length === 2);
  await t.c.generations.shutdown(1000);
  await events;
  await new Promise((r) => setTimeout(r, 50));
  const list = (await (await get('/api/conversations')).json()) as {
    items: { title: string | null; titleSource: string }[];
  };
  expect(list.items[0]?.title).toBeNull();
  expect(list.items[0]?.titleSource).toBe('none');
});

test('approval endpoint resolves a waiting call and remember saves the policy', async () => {
  const execute = async (args: unknown) => ({
    ok: true as const,
    content: `echo: ${JSON.stringify(args)}`,
  });
  t.c.tools.add(() => [
    {
      name: 'echo',
      description: 'Echo the input.',
      parameters: { type: 'object', properties: { q: { type: 'string' } } },
      source: 'mcp',
      defaultPolicy: 'ask',
      execute,
    },
  ]);
  const toolCall = { index: 0, id: 'call_1', type: 'function' };
  mock.enqueue(
    {
      frames: [
        chunk({ tool_calls: [{ ...toolCall, function: { name: 'echo', arguments: '' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '{"q":"hi"}' } }] }),
        finish('tool_calls'),
        DONE,
      ],
    },
    { frames: textFrames('Selesai') },
  );
  const all = readEvents(await chat(turn()));
  await waitFor(
    () =>
      activeCount() === 1 &&
      (
        t.c.generations.get(t.c.generations.active(userId)[0]?.id ?? '')?.snapshot().parts ?? []
      ).some((p) => p.type === 'tool_call' && p.status === 'awaiting_approval'),
  );
  const g = t.c.generations.active(userId)[0];
  const approve = (body: unknown, id = g?.id) =>
    api(`/api/generations/${id}/approvals`, { method: 'POST', body: JSON.stringify(body) });
  expect((await approve({ callId: 'call_x', decision: 'allow' })).status).toBe(404);
  expect((await approve({ callId: 'call_1', decision: 'maybe' })).status).toBe(400);
  expect((await approve({ callId: 'call_1', decision: 'allow' }, 'gen_unknown')).status).toBe(404);
  expect((await approve({ callId: 'call_1', decision: 'allow', remember: true })).status).toBe(204);
  const fin = finishedOf(await all)[0] as Finished;
  expect(fin.message.status).toBe('complete');
  expect(fin.message.parts[0]).toMatchObject({ type: 'tool_call', status: 'ok', source: 'mcp' });
  expect(textOf(fin.message)).toBe('Selesai');
  const second = chatCalls()[1]?.body as { messages: { role: string; tool_call_id?: string }[] };
  expect(second.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call_1' });
  const settings = (await (await get('/api/settings')).json()) as {
    settings: { tools: { policies: Record<string, string> } };
  };
  expect(settings.settings.tools.policies.echo).toBe('auto');
  expect((await approve({ callId: 'call_1', decision: 'allow' })).status).toBe(404);

  const tools = (await (await get('/api/tools')).json()) as {
    tools: { name: string; policy: string; defaultPolicy: string; source: string }[];
    webSearchBackend: boolean;
  };
  expect(tools).toEqual({
    tools: [
      expect.objectContaining({ name: 'fetch_url', source: 'app', defaultPolicy: 'auto' }),
      expect.objectContaining({ name: 'delegate_tasks', source: 'app', defaultPolicy: 'auto' }),
      {
        name: 'echo',
        description: 'Echo the input.',
        source: 'mcp',
        policy: 'auto',
        defaultPolicy: 'ask',
      },
    ],
    webSearchBackend: false,
  });
});
