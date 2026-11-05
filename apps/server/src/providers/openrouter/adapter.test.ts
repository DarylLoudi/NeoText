import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { type MockProvider, startMockProvider } from '../../../test-support/mock-provider';
import { fixtureFrames } from '../../../test-support/sse-frames';
import { createHttpClient, type HttpClient } from '../../net/http-client';
import type { ChatRequest, ProviderEvent, ResolvedProvider } from '../types';
import { createOpenRouterAdapter, OPENROUTER_BASE_URL } from './adapter';

const adapter = createOpenRouterAdapter();
const baseReq: ChatRequest = {
  model: 'deepseek/deepseek-v4.1-flash',
  messages: [{ role: 'user', content: 'hi' }],
};
const catalog = readFileSync(
  new URL('../../../test-support/fixtures/openrouter-models.json', import.meta.url),
  'utf8',
);
const search = { engine: 'parallel', mode: 'fast', max_results: 5 };

let mock: MockProvider;
let http: HttpClient;
let p: ResolvedProvider;
const signal = new AbortController().signal;

beforeAll(async () => {
  mock = await startMockProvider();
  http = createHttpClient({ allowPrivate: true });
});
afterAll(async () => {
  await http.close();
  await mock.close();
});
beforeEach(() => {
  mock.reset();
  p = {
    id: 'prv_or',
    kind: 'openrouter',
    baseUrl: mock.url,
    apiKey: 'sk-or-test',
    headers: {},
    manualModels: [],
    http,
    appUrl: 'http://localhost:3420',
  };
});

async function collect(frames?: string[], req = baseReq) {
  if (frames) mock.enqueue({ frames });
  const evs: ProviderEvent[] = [];
  for await (const e of adapter.streamChat(p, req, signal)) evs.push(e);
  return evs;
}

describe('openrouter adapter', () => {
  test('exposes the public base URL and kind', () => {
    expect(OPENROUTER_BASE_URL).toBe('https://openrouter.ai/api/v1');
    expect(adapter.kind).toBe('openrouter');
  });

  test('attribution headers and server web search', async () => {
    await collect(undefined, {
      ...baseReq,
      serverTools: [{ type: 'openrouter:web_search', parameters: search }],
      maxServerToolCalls: 3,
    });
    const r = mock.requests.at(-1);
    expect(r?.headers.authorization).toBe('Bearer sk-or-test');
    expect(r?.headers['x-openrouter-title']).toBe('NeoText');
    expect(r?.headers['http-referer']).toBe('http://localhost:3420');
    expect(r?.body).toMatchObject({
      tools: [{ type: 'openrouter:web_search', parameters: search }],
      max_tool_calls: 3,
    });
    expect(r?.body).not.toHaveProperty('stream_options');
  });

  test('citations, processing, reasoning, meta and usage from the search recording', async () => {
    const evs = await collect(fixtureFrames('openrouter-search'));
    expect(evs.filter((e) => e.type === 'citation')).toHaveLength(3);
    expect(evs.some((e) => e.type === 'processing')).toBe(true);
    expect(evs.find((e) => e.type === 'meta' && e.upstreamProvider)).toMatchObject({
      upstreamProvider: 'Wafer',
    });
    expect(evs.find((e) => e.type === 'usage')).toMatchObject({
      usage: {
        costUsd: 0.001250971,
        cachedTokens: 768,
        reasoningTokens: 158,
        webSearchRequests: 1,
      },
    });
  });

  test('reasoning_details are surfaced for replay', async () => {
    const evs = await collect(fixtureFrames('openrouter-tools'));
    expect(evs.find((e) => e.type === 'reasoning_details')).toMatchObject({
      details: [{ type: 'reasoning.text' }],
    });
  });

  test('listModels maps the catalog and sorts by name', async () => {
    mock.modelsBody = catalog;
    const models = await adapter.listModels(p, signal);
    expect(mock.requests.at(-1)?.path).toBe('/v1/models');
    expect(models.map((m) => m.name)).toEqual([
      'Anthropic: Claude Haiku 5.5',
      'DeepSeek: DeepSeek V4.1 Flash',
      'Google: Gemma 4 31B (free)',
    ]);
    expect(models[1]?.providerId).toBe('prv_or');
  });

  test('test() calls /key', async () => {
    const res = await adapter.test(p, signal);
    expect(res).toMatchObject({ ok: true, modelCount: null });
    expect(mock.requests.at(-1)?.path).toBe('/v1/key');
    expect(mock.requests.at(-1)?.headers.authorization).toBe('Bearer sk-or-test');
  });

  test('test() reports a rejected key', async () => {
    mock.keyStatus = 401;
    const res = await adapter.test(p, signal);
    expect(res).toMatchObject({ ok: false, code: 'auth' });
  });

  test('warm() calls /key and swallows errors', async () => {
    await adapter.warm(p);
    expect(mock.requests.at(-1)?.path).toBe('/v1/key');
    mock.keyStatus = 500;
    await expect(adapter.warm(p)).resolves.toBeUndefined();
    await expect(adapter.warm({ ...p, baseUrl: 'http://127.0.0.1:1/v1' })).resolves.toBeUndefined();
  });
});
