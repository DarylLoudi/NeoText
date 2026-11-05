import type { StreamEvent } from '@neotext/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { readEvents } from '../../test-support/sse-client';
import { authed, createTestApp, setupOwner } from '../../test-support/test-app';
import { openRouterWebSearch } from '../chat/generation/web-search';
import { createHttpClient, type HttpClient } from '../net/http-client';
import { createOpenRouterAdapter, OPENROUTER_BASE_URL } from '../providers/openrouter/adapter';
import type { ChatRequest, ProviderEvent, ResolvedProvider } from '../providers/types';

// Opt-in: runs only with OPENROUTER_API_KEY set (root .env). Real network, real (tiny) cost.
const key = process.env.OPENROUTER_API_KEY;
const live = test.skipIf(!key);
const MODEL = 'deepseek/deepseek-v4.1-flash';
const adapter = createOpenRouterAdapter();

let http: HttpClient;
let provider: ResolvedProvider;

beforeAll(() => {
  http = createHttpClient({ allowPrivate: false });
  provider = {
    id: 'prv_live',
    kind: 'openrouter',
    baseUrl: OPENROUTER_BASE_URL,
    apiKey: key ?? null,
    headers: {},
    manualModels: [],
    http,
    appUrl: 'http://localhost:3420',
  };
});
afterAll(async () => {
  await http?.close();
});

async function run(req: Partial<ChatRequest> & Pick<ChatRequest, 'messages'>) {
  const events: ProviderEvent[] = [];
  const request: ChatRequest = { model: MODEL, maxTokens: 200, ...req };
  for await (const e of adapter.streamChat(provider, request, AbortSignal.timeout(50_000))) {
    events.push(e);
  }
  const errors = events.filter((e) => e.type === 'error');
  expect(errors).toEqual([]);
  return events;
}
const usageOf = (events: ProviderEvent[]) =>
  events.flatMap((e) => (e.type === 'usage' ? [e.usage] : [])).at(-1);

live('streams text with cost', async () => {
  const events = await run({
    messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
    maxTokens: 20,
  });
  const text = events.flatMap((e) => (e.type === 'text' ? [e.text] : [])).join('');
  expect(text.toLowerCase()).toContain('pong');
  const usage = usageOf(events);
  expect(usage?.costUsd).toBeGreaterThan(0);
  console.info(`live cost (text): ${usage?.costUsd} USD`);
});

live('web search returns citations', async () => {
  const events = await run({
    messages: [{ role: 'user', content: 'What is the latest Node.js LTS version? One sentence.' }],
    maxTokens: 150,
    ...openRouterWebSearch({ maxResults: 2, maxSearchesPerTurn: 1 }),
  });
  expect(events.filter((e) => e.type === 'citation').length).toBeGreaterThanOrEqual(1);
  const usage = usageOf(events);
  expect(usage?.webSearchRequests).toBeGreaterThanOrEqual(1);
  console.info(`live cost (web search): ${usage?.costUsd} USD`);
});

live('function tool call shape', async () => {
  const events = await run({
    messages: [{ role: 'user', content: 'Weather in Jakarta? Use the tool.' }],
    // Forced, so a model that would rather answer in words still shows the call's shape.
    toolChoice: 'required',
    maxTokens: 300,
    tools: [
      {
        name: 'get_weather',
        description: 'Get the current weather for a city.',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    ],
  });
  const start = events.find((e) => e.type === 'tool_call_start');
  expect(start).toMatchObject({ name: 'get_weather' });
  const args = events.flatMap((e) => (e.type === 'tool_call_delta' ? [e.args] : [])).join('');
  expect(JSON.parse(args)).toHaveProperty('city');
  console.info(`live cost (tool): ${usageOf(events)?.costUsd} USD`);
});

live('full app turn with a title', async () => {
  const t = await createTestApp({ env: { OPENROUTER_API_KEY: key as string } });
  try {
    const owner = await setupOwner(t, { useEnvProvider: true });
    const api = authed(t, owner.cookie);
    const list = (await (await api('/api/providers')).json()) as { providers: { id: string }[] };
    const providerId = list.providers[0]?.id as string;
    const res = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: null,
        parentId: null,
        userMessage: { text: 'Say hi in three words.' },
        targets: [{ providerId, modelId: MODEL }],
        options: { maxOutputTokens: 40 },
      }),
    });
    const evs: StreamEvent[] = await readEvents(res);
    const fin = evs.find((e) => e.type === 'generation.finished');
    expect(fin?.type === 'generation.finished' && fin.message.status).toBe('complete');
    expect(evs.some((e) => e.type === 'conversation.updated')).toBe(true);
    const total = t.c.db.raw.prepare('select sum(cost_usd) as c from usage_events').get();
    console.info('live cost (app turn, chat + title):', JSON.stringify(total), 'USD');
  } finally {
    await t.close();
  }
});
