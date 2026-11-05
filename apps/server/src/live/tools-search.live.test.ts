import type { MessagePublic, StreamEvent } from '@neotext/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { readEvents } from '../../test-support/sse-client';
import { authed, createTestApp, setupOwner, type TestApp } from '../../test-support/test-app';
import { openRouterWebSearch } from '../chat/generation/web-search';
import { createHttpClient, type HttpClient } from '../net/http-client';
import { toRequestBody } from '../providers/openai-compatible/request';
import { createOpenRouterAdapter, OPENROUTER_BASE_URL } from '../providers/openrouter/adapter';
import type { ChatRequest, ProviderEvent } from '../providers/types';

// Opt-in: runs only with OPENROUTER_API_KEY set (root .env). Real network, real (tiny) cost.
const key = process.env.OPENROUTER_API_KEY;
const live = test.skipIf(!key);
const DEEPSEEK = 'deepseek/deepseek-v4.1-flash';
// The cheapest real-time Claude Haiku in OpenRouter's catalog (the `:batch` one does not stream).
const HAIKU = 'anthropic/claude-haiku-5.5';

type Finished = Extract<StreamEvent, { type: 'generation.finished' }>;

let http: HttpClient;
beforeAll(() => {
  http = createHttpClient({ allowPrivate: false });
});
afterAll(async () => {
  await http?.close();
});

/** One turn through the real chat route, with the env provider and the given settings. */
async function appTurn(input: {
  model: string;
  text: string;
  settings: Record<string, unknown>;
  webSearch?: boolean;
  maxOutputTokens: number;
  reasoningEffort?: string;
}): Promise<{
  message: MessagePublic;
  calls: number;
  cost: unknown;
  bodies: Record<string, unknown>[];
}> {
  const t: TestApp = await createTestApp({ env: { OPENROUTER_API_KEY: key as string } });
  // The bodies sent to the chat endpoint, read from a wrapped client (headers never kept).
  const bodies: Record<string, unknown>[] = [];
  for (const client of [t.c.http.endpoints, t.c.http.endpointsPrivate]) {
    const fetch = client.fetch.bind(client);
    client.fetch = (url, init) => {
      if (url.endsWith('/chat/completions') && typeof init?.body === 'string') {
        bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      }
      return fetch(url, init);
    };
  }
  try {
    const owner = await setupOwner(t, { useEnvProvider: true });
    const api = authed(t, owner.cookie);
    const patch = { chat: { autoTitle: false }, ...input.settings };
    const saved = await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ patch }) });
    expect(saved.ok).toBe(true);
    const list = (await (await api('/api/providers')).json()) as { providers: { id: string }[] };
    const providerId = list.providers[0]?.id as string;
    const res = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: null,
        parentId: null,
        userMessage: { text: input.text },
        targets: [{ providerId, modelId: input.model }],
        options: {
          maxOutputTokens: input.maxOutputTokens,
          webSearch: input.webSearch ?? false,
          ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
        },
      }),
    });
    const evs: StreamEvent[] = await readEvents(res);
    const fin = evs.find((e): e is Finished => e.type === 'generation.finished');
    if (!fin) throw new Error('The turn did not finish.');
    const rows = t.c.db.raw
      .prepare('select count(*) as n, sum(cost_usd) as c from usage_events')
      .get() as { n: number; c: unknown };
    const m = fin.message;
    // What happened, without the message text: enough to tell a failed step from an empty one.
    console.info(
      `live turn (${input.model}): status ${m.status}, finish ${m.finishReason}, ` +
        `parts ${m.parts.map((p) => (p.type === 'tool_call' ? `tool_call:${p.status}` : p.type)).join(',')}, ` +
        `errors ${JSON.stringify(m.parts.filter((p) => p.type === 'error'))}, calls ${rows.n}, ` +
        `tokens ${m.usage?.promptTokens}/${m.usage?.completionTokens}/${m.usage?.reasoningTokens}`,
    );
    return { message: m, calls: rows.n, cost: rows.c, bodies };
  } finally {
    await t.close();
  }
}

const errorsOf = (m: MessagePublic) => m.parts.filter((p) => p.type === 'error');

live('web search on DeepSeek through the chat route brings sources', async () => {
  const { message, calls, cost } = await appTurn({
    model: DEEPSEEK,
    text: 'What is the latest Node.js LTS version? One sentence.',
    settings: { webSearch: { maxResults: 2, maxSearchesPerTurn: 1 } },
    webSearch: true,
    maxOutputTokens: 150,
  });
  expect(errorsOf(message)).toEqual([]);
  expect(message.status).toBe('complete');
  const sources = message.parts.flatMap((p) => (p.type === 'sources' ? p.sources : []));
  expect(sources.length).toBeGreaterThanOrEqual(1);
  expect(sources.every((s) => /^https?:\/\//.test(s.url))).toBe(true);
  console.info(
    `live (route web search, ${DEEPSEEK}): ${sources.length} sources, ${calls} call(s), ${cost} USD`,
  );
});

live(
  'R21: perplexity with a stale saved mode goes out without a mode and is accepted',
  async () => {
    // A mode saved for Parallel, left behind after switching the engine to Perplexity.
    const search = openRouterWebSearch({
      engine: 'perplexity',
      mode: 'fast',
      maxResults: 2,
      maxSearchesPerTurn: 1,
    });
    const request: ChatRequest = {
      model: DEEPSEEK,
      messages: [{ role: 'user', content: 'Who won the most recent Ballon d’Or? One sentence.' }],
      maxTokens: 120,
      ...search,
    };
    const body = toRequestBody(request, 'openrouter') as {
      tools: { type: string; parameters: Record<string, unknown> }[];
    };
    expect(body.tools[0]?.parameters).toEqual({ engine: 'perplexity', max_results: 2 });

    const adapter = createOpenRouterAdapter();
    const provider = {
      id: 'prv_live',
      kind: 'openrouter' as const,
      baseUrl: OPENROUTER_BASE_URL,
      apiKey: key ?? null,
      headers: {},
      manualModels: [],
      http,
      appUrl: 'http://localhost:3420',
    };
    const events: ProviderEvent[] = [];
    for await (const e of adapter.streamChat(provider, request, AbortSignal.timeout(50_000))) {
      events.push(e);
    }
    const errors = events.filter((e) => e.type === 'error');
    expect(errors).toEqual([]);
    expect(events.some((e) => e.type === 'text')).toBe(true);
    const usage = events.flatMap((e) => (e.type === 'usage' ? [e.usage] : [])).at(-1);
    console.info(
      `live (R21 perplexity, ${DEEPSEEK}): ${events.filter((e) => e.type === 'citation').length} citations, ` +
        `${usage?.webSearchRequests} search(es), ${usage?.costUsd} USD`,
    );
  },
);

live('R6: a Claude turn that wants more tool steps than allowed still answers', async () => {
  const { message, calls, cost, bodies } = await appTurn({
    model: HAIKU,
    text:
      'Use fetch_url on https://example.com five separate times, one call per step, ' +
      'before you answer. Then tell me the page title.',
    settings: { tools: { maxSteps: 2 } },
    // Thinking is on by default for this model and would spend a small token budget by itself.
    reasoningEffort: 'none',
    maxOutputTokens: 300,
  });
  expect(errorsOf(message)).toEqual([]);
  expect(message.status).toBe('complete');
  const toolCalls = message.parts.filter((p) => p.type === 'tool_call');
  expect(toolCalls.length).toBeGreaterThanOrEqual(1);
  // Two model calls: one with tools, then the last one without.
  expect(calls).toBe(2);
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toHaveProperty('tools');
  const last = bodies[1] as { tools?: unknown; messages: { role: string }[] };
  expect(last).not.toHaveProperty('tools');
  expect(last.messages.some((m) => m.role === 'tool')).toBe(true);
  console.info(
    `live (R6, ${HAIKU} via ${message.usage?.upstreamProvider}): ${toolCalls.length} tool call(s), ` +
      `${calls} call(s), ${cost} USD`,
  );
});
