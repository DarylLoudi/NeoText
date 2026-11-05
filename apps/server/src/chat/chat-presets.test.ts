import type { ConversationDetail, Preset, PresetData, StreamEvent } from '@neotext/shared';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { type MockProvider, startMockProvider } from '../../test-support/mock-provider';
import { readEvents } from '../../test-support/sse-client';
import { textFrames } from '../../test-support/sse-frames';
import {
  addUser,
  authContextFor,
  authed,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';
import { aad } from '../crypto/aad';
import { sealJson } from '../crypto/aead';

let t: TestApp;
let mock: MockProvider;
let api: ReturnType<typeof authed>;
let cookie: string;
let providerId: string;

beforeEach(async () => {
  t = await createTestApp();
  mock = await startMockProvider();
  mock.models = ['m1'];
  cookie = (await setupOwner(t)).cookie;
  api = authed(t, cookie);
  const res = await api('/api/providers', {
    method: 'POST',
    body: JSON.stringify({ kind: 'openai-compatible', name: 'Mock', baseUrl: mock.url }),
  });
  providerId = ((await res.json()) as { provider: { id: string } }).provider.id;
});
afterEach(async () => {
  await t.close();
  await mock.close();
});

const data = (over: Partial<PresetData> = {}): PresetData => ({
  systemPrompt: '',
  model: null,
  reasoningEffort: null,
  temperature: null,
  maxOutputTokens: null,
  webSearch: false,
  color: null,
  ...over,
});
const makePreset = async (over: Partial<PresetData>) =>
  (await (
    await api('/api/presets', {
      method: 'POST',
      body: JSON.stringify({ name: 'P', data: data(over), position: 'a0' }),
    })
  ).json()) as Preset;
const patchChat = (chat: Record<string, unknown>) =>
  api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({ patch: { chat: { includeDate: false, ...chat } } }),
  });
const turn = (options: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
  conversationId: null,
  parentId: null,
  userMessage: { text: 'Hai' },
  targets: [{ providerId, modelId: 'm1' }],
  options,
  ...over,
});
const send = async (body: unknown, as: typeof api = api) => {
  mock.requests.length = 0;
  mock.enqueue({ frames: textFrames('ok') });
  const res = await as('/api/chat', { method: 'POST', body: JSON.stringify(body) });
  if (res.status !== 200) return { res, evs: [] as StreamEvent[], sent: null };
  const evs = await readEvents(res);
  const sent = mock.requests.find((r) => r.path === '/v1/chat/completions')?.body as {
    messages: { role: string; content: string }[];
    temperature?: number;
  };
  return { res, evs, sent };
};
const conversationOf = (evs: StreamEvent[]) =>
  (evs.find((e) => e.type === 'generation.started') as { conversationId: string }).conversationId;
const detail = async (id: string) =>
  (await (await api(`/api/conversations/${id}`)).json()) as ConversationDetail;

test('preset system prompt replaces the default', async () => {
  await patchChat({ defaultSystemPrompt: 'A' });
  const preset = await makePreset({ systemPrompt: 'B' });
  const { sent, evs } = await send(turn({ presetId: preset.id }));
  expect(sent?.messages[0]).toEqual({ role: 'system', content: 'B' });
  expect((await detail(conversationOf(evs))).conversation.presetId).toBe(preset.id);
});

test('an empty preset prompt leaves the default', async () => {
  await patchChat({ defaultSystemPrompt: 'A' });
  const preset = await makePreset({ systemPrompt: '' });
  const { sent } = await send(turn({ presetId: preset.id }));
  expect(sent?.messages[0]).toEqual({ role: 'system', content: 'A' });
});

test('explicit options beat the preset; preset beats settings', async () => {
  await patchChat({ temperature: 1.5 });
  const preset = await makePreset({ temperature: 0.3 });
  expect((await send(turn({ presetId: preset.id }))).sent?.temperature).toBe(0.3);
  expect((await send(turn({ presetId: preset.id, temperature: 0.9 }))).sent?.temperature).toBe(0.9);
  expect((await send(turn())).sent?.temperature).toBe(1.5);
});

test('other users cannot use a preset', async () => {
  const preset = await makePreset({ systemPrompt: 'B' });
  const other = authed(t, (await addUser(t, 'mira')).cookie);
  const { res } = await send(turn({ presetId: preset.id }), other);
  expect(res.status).toBe(404);
});

test('an unknown preset id is a 404', async () => {
  expect((await send(turn({ presetId: 'pst_missing' }))).res.status).toBe(404);
});

test('a conversation keeps its preset; deleting it falls back to the default', async () => {
  await patchChat({ defaultSystemPrompt: 'A' });
  const preset = await makePreset({ systemPrompt: 'B' });
  const first = await send(turn({ presetId: preset.id }));
  const conversationId = conversationOf(first.evs);
  const parentId = (await detail(conversationId)).conversation.activeLeafId;
  const again = await send(turn({}, { conversationId, parentId }));
  expect(again.sent?.messages[0]?.content).toBe('B');
  await api(`/api/presets/${preset.id}`, { method: 'DELETE' });
  const parent2 = (await detail(conversationId)).conversation.activeLeafId;
  const after = await send(turn({}, { conversationId, parentId: parent2 }));
  expect(after.res.status).toBe(200);
  expect(after.sent?.messages[0]?.content).toBe('A');
});

test('a broken preset is skipped in the list and its chats use settings', async () => {
  await patchChat({ defaultSystemPrompt: 'A' });
  const good = await makePreset({ systemPrompt: 'G' });
  const garbage = await makePreset({ systemPrompt: 'B' });
  const wrongShape = await makePreset({ systemPrompt: 'C' });
  const first = await send(turn({ presetId: garbage.id }));
  const conversationId = conversationOf(first.evs);
  t.c.db.raw
    .prepare('UPDATE presets SET data = ? WHERE id = ?')
    .run(Buffer.from('junk'), garbage.id);
  const { dek } = authContextFor(t, cookie);
  t.c.db.raw
    .prepare('UPDATE presets SET data = ? WHERE id = ?')
    .run(sealJson(dek, { systemPrompt: 5 }, aad('presets', 'data', wrongShape.id)), wrongShape.id);

  const list = (await (await api('/api/presets')).json()) as { presets: Preset[] };
  expect(list.presets.map((p) => p.id)).toEqual([good.id]);
  expect((await send(turn({ presetId: garbage.id }))).res.status).toBe(404);

  const parentId = (await detail(conversationId)).conversation.activeLeafId;
  const after = await send(turn({}, { conversationId, parentId }));
  expect(after.res.status).toBe(200);
  expect(after.sent?.messages[0]?.content).toBe('A');
});
