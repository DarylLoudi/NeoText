import type { MessagePublic, StreamEvent } from '@neotext/shared';
import { newId } from '@neotext/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  authContextFor,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../../test-support/test-app';
import { usageEvents } from '../../db/schema';
import type { AuthContext } from '../../http/env';
import { ProviderError } from '../../providers/errors';
import type { ProviderAdapter, ProviderEvent, ProviderUsage } from '../../providers/types';
import { createGeneration, type Generation } from './generation';
import { type RunDeps, type RunSpec, runGeneration } from './runner';
import { openRouterWebSearch } from './web-search';
import { createMessageWriter } from './writer';

type Step = ProviderEvent | Error | (() => void);

const model = { providerId: 'prv_1', modelId: 'm/1' };
const usage: ProviderUsage = {
  promptTokens: 10,
  completionTokens: 5,
  reasoningTokens: 0,
  cachedTokens: 0,
  costUsd: 0.0001,
  webSearchRequests: 0,
};
const text = (t: string): ProviderEvent => ({ type: 'text', text: t });
const stop: ProviderEvent = { type: 'finish', reason: 'stop' };
const upstream = (retryAfterMs: number | null = 1) =>
  new ProviderError('upstream', 'boom', { retryable: true, retryAfterMs });

function fakeAdapter(attempts: Step[][]) {
  const streamChat = vi.fn(async function* (_p: unknown, _r: unknown, _s: AbortSignal) {
    const steps = attempts[streamChat.mock.calls.length - 1] ?? [];
    for (const s of steps) {
      if (s instanceof Error) throw s;
      if (typeof s === 'function') s();
      else yield s;
    }
  });
  return { adapter: { streamChat } as unknown as ProviderAdapter, streamChat };
}

let t: TestApp;
let auth: AuthContext;
let convId: string;
const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as never;

beforeEach(async () => {
  t = await createTestApp();
  auth = authContextFor(t, (await setupOwner(t)).cookie);
  convId = t.c.conversations.create(auth, { title: 'c' }).id;
});
afterEach(async () => {
  await t.close();
});

async function run(
  attempts: Step[][],
  over: Partial<RunSpec> = {},
  hook?: (g: Generation) => void,
  depsOver: Partial<RunDeps> = {},
) {
  const id = newId('msg');
  t.c.repos.messages.insert(
    {
      id,
      conversationId: convId,
      userId: auth.userId,
      parentId: null,
      role: 'assistant',
      status: 'streaming',
      parts: [],
      providerId: model.providerId,
      modelId: model.modelId,
      createdAt: t.clock.now(),
    },
    auth.dek,
  );
  const message = t.c.repos.messages.get(id, auth.dek) as MessagePublic;
  const generation = createGeneration({
    id: newId('gen'),
    userId: auth.userId,
    conversationId: convId,
    message,
    model,
    startedAt: t.clock.now(),
    log,
  });
  hook?.(generation);
  const events: StreamEvent[] = [];
  generation.subscribe((e) => events.push(e));
  const { adapter, streamChat } = fakeAdapter(attempts);
  const touch = vi.fn();
  await runGeneration(
    {
      generation,
      adapter,
      provider: {} as never,
      request: {} as never,
      webSearch: false,
      writer: createMessageWriter({
        messages: t.c.repos.messages,
        dek: auth.dek,
        messageId: id,
        clock: t.clock,
        log,
      }),
      userId: auth.userId,
      conversationId: convId,
      model,
      ...over,
    },
    { clock: t.clock, log, usage: t.c.repos.usage, conversationsTouch: touch, ...depsOver },
  );
  const stored = t.c.repos.messages.get(id, auth.dek) as MessagePublic;
  const usageRows = t.c.db.orm.select().from(usageEvents).all();
  return { generation, events, stored, streamChat, touch, usageRows };
}

test('happy path persists text, usage and emits in order', async () => {
  const r = await run([[text('Halo! '), text('Apa kabar?'), stop, { type: 'usage', usage }]]);
  const types = r.events.map((e) => e.type);
  expect(types.slice(-2)).toEqual(['usage', 'generation.finished']);
  expect(r.events.map((e) => e.seq)).toEqual(r.events.map((_, i) => i + 1));
  expect(r.stored.status).toBe('complete');
  expect(r.stored.parts).toEqual([{ type: 'text', text: 'Halo! Apa kabar?' }]);
  expect(r.stored.usage?.costUsd).toBe(0.0001);
  expect(r.stored.finishReason).toBe('stop');
  expect(r.usageRows).toHaveLength(1);
  expect(r.usageRows[0]?.kind).toBe('chat');
  expect(r.touch).toHaveBeenCalledWith(convId, expect.any(Number));
  await expect(r.generation.closed).resolves.toBeUndefined();
});

test('retries once before the first token', async () => {
  const r = await run([[upstream()], [text('ok'), stop]]);
  expect(r.streamChat).toHaveBeenCalledTimes(2);
  expect(r.stored.status).toBe('complete');
  expect(r.stored.parts).toEqual([{ type: 'text', text: 'ok' }]);
});

test('retries on an error event too, but only once', async () => {
  const err: ProviderEvent = { type: 'error', error: upstream() };
  const r = await run([[err], [err], [text('never'), stop]]);
  expect(r.streamChat).toHaveBeenCalledTimes(2);
  expect(r.stored.status).toBe('error');
  expect(r.stored.parts).toEqual([{ type: 'error', code: 'upstream', message: 'boom' }]);
});

test('rate limit with a long retry-after is not retried', async () => {
  const e = new ProviderError('rate_limit', 'slow down', { retryable: true, retryAfterMs: 6000 });
  const r = await run([[e], [text('x'), stop]]);
  expect(r.streamChat).toHaveBeenCalledTimes(1);
  expect(r.stored.status).toBe('error');
});

test('non-retryable errors are not retried', async () => {
  const r = await run([[new ProviderError('auth', 'bad key')], [text('x'), stop]]);
  expect(r.streamChat).toHaveBeenCalledTimes(1);
  expect(r.stored.parts).toEqual([{ type: 'error', code: 'auth', message: 'bad key' }]);
});

test('does not retry after tokens; error after tokens keeps partial text', async () => {
  const r = await run([
    [text('Partial '), { type: 'error', error: upstream() }],
    [text('x'), stop],
  ]);
  expect(r.streamChat).toHaveBeenCalledTimes(1);
  expect(r.stored.status).toBe('error');
  expect(r.stored.parts).toEqual([
    { type: 'text', text: 'Partial ' },
    { type: 'error', code: 'upstream', message: 'boom' },
  ]);
});

test('abort keeps what arrived', async () => {
  let g!: Generation;
  const r = await run(
    [[text('Halo '), () => g.abort('user'), text('tidak sampai'), stop]],
    {},
    (x) => {
      g = x;
    },
  );
  expect(r.stored.status).toBe('aborted');
  expect(r.stored.parts).toEqual([{ type: 'text', text: 'Halo ' }]);
});

test('shutdown marks interrupted', async () => {
  let g!: Generation;
  const r = await run([[text('a'), () => g.abort('shutdown'), text('b')]], {}, (x) => {
    g = x;
  });
  expect(r.stored.status).toBe('interrupted');
  expect(r.stored.parts).toEqual([{ type: 'text', text: 'a' }]);
});

test('aborting during the retry wait ends aborted without a second attempt', async () => {
  let g!: Generation;
  setTimeout(() => g.abort('user'), 20);
  const r = await run([[upstream(3000)], [text('x'), stop]], {}, (x) => {
    g = x;
  });
  expect(r.streamChat).toHaveBeenCalledTimes(1);
  expect(r.stored.status).toBe('aborted');
});

test('empty response is an error', async () => {
  const r = await run([[stop]]);
  expect(r.stored.status).toBe('error');
  expect(r.stored.parts).toEqual([
    {
      type: 'error',
      code: 'empty_response',
      message: 'The model returned an empty response. Try again or pick another model.',
    },
  ]);
});

test('an answer budget spent on hidden thinking says so, not just "empty"', async () => {
  const thought: ProviderEvent = { type: 'usage', usage: { ...usage, reasoningTokens: 200 } };
  const length: ProviderEvent = { type: 'finish', reason: 'length' };
  for (const step of [[thought, length], [length], [thought, stop]]) {
    const r = await run([step]);
    expect(r.stored.status).toBe('error');
    expect(r.stored.parts).toEqual([
      {
        type: 'error',
        code: 'thinking_budget',
        message:
          'The model used its whole answer budget on thinking. Try again, or raise the answer length or lower the reasoning effort.',
      },
    ]);
  }
});

test('a stream that ends without finish completes when there is output', async () => {
  const r = await run([[text('hi')]]);
  expect(r.stored.status).toBe('complete');
  expect(r.stored.finishReason).toBe('unknown');
});

test('a stream that ends without finish and without output is empty_response', async () => {
  const r = await run([[]]);
  expect(r.stored.status).toBe('error');
  expect(r.stored.parts[0]).toMatchObject({ type: 'error', code: 'empty_response' });
});

test('length finish is still complete', async () => {
  const r = await run([[text('cut'), { type: 'finish', reason: 'length' }]]);
  expect(r.stored.status).toBe('complete');
  expect(r.stored.finishReason).toBe('length');
});

test('ttft and duration are measured with the clock', async () => {
  const r = await run([
    [
      () => t.clock.advance(300),
      { type: 'meta', upstreamProvider: 'DeepInfra' },
      text('a'),
      () => t.clock.advance(700),
      stop,
      { type: 'usage', usage },
    ],
  ]);
  expect(r.stored.usage).toMatchObject({
    ttftMs: 300,
    durationMs: 1000,
    upstreamProvider: 'DeepInfra',
  });
});

test('an unexpected throw still ends as error with a persisted error part', async () => {
  const r = await run([[text('par'), new Error('kaboom secret')]]);
  expect(r.stored.status).toBe('error');
  expect(r.stored.parts[0]).toEqual({ type: 'text', text: 'par' });
  expect(r.stored.parts[1]).toMatchObject({ type: 'error', code: 'internal' });
  expect(JSON.stringify(r.stored.parts)).not.toContain('kaboom');
  await expect(r.generation.closed).resolves.toBeUndefined();
});

test('a finished generation logs its timings and nothing it said', async () => {
  const info = vi.fn();
  await run([[text('secret answer'), stop]], {}, undefined, {
    log: { error: vi.fn(), warn: vi.fn(), info } as never,
  });
  const call = info.mock.calls.find(([, msg]) => msg === 'generation finished');
  expect(call?.[0]).toEqual({
    generationId: expect.stringMatching(/^gen_/),
    ttftMs: expect.any(Number),
    durationMs: expect.any(Number),
  });
  expect(JSON.stringify(info.mock.calls)).not.toContain('secret');
});

test('a failing afterFinish is logged and the generation still closes', async () => {
  const afterFinish = vi.fn().mockRejectedValue(new Error('hook'));
  const r = await run([[text('a'), stop]], { afterFinish });
  expect(afterFinish).toHaveBeenCalledWith(expect.objectContaining({ status: 'complete' }));
  await expect(r.generation.closed).resolves.toBeUndefined();
  expect(r.stored.status).toBe('complete');
});

test('afterFinish runs before the generation closes', async () => {
  const order: string[] = [];
  const r = await run([[text('a'), stop]], {
    afterFinish: async () => {
      order.push('after');
    },
  });
  await r.generation.closed;
  order.push('closed');
  expect(order).toEqual(['after', 'closed']);
});

test('openRouterWebSearch defaults', () => {
  expect(openRouterWebSearch()).toEqual({
    serverTools: [
      {
        type: 'openrouter:web_search',
        parameters: { engine: 'parallel', mode: 'fast', max_results: 5 },
      },
    ],
    maxServerToolCalls: 3,
  });
});

test('openRouterWebSearch overrides and omits nulls', () => {
  expect(
    openRouterWebSearch({
      engine: 'exa',
      mode: null,
      maxResults: 8,
      maxSearchesPerTurn: 1,
      contextSize: 'high',
    }),
  ).toEqual({
    serverTools: [
      {
        type: 'openrouter:web_search',
        parameters: { engine: 'exa', max_results: 8, search_context_size: 'high' },
      },
    ],
    maxServerToolCalls: 1,
  });
});

const preResults = [
  { url: 'https://a.test/x', title: 'First', snippet: 'one' },
  { url: 'http://a.test/x', title: 'Dup', snippet: 'dup' },
  { url: 'https://b.test/y', title: 'Second', snippet: 'two' },
];
const preMessages = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'btc?' },
] as never;
const sentMessages = (r: { streamChat: { mock: { calls: unknown[][] } } }) =>
  (
    (r.streamChat.mock.calls[0] as unknown[])[1] as {
      messages: { role: string; content: string }[];
    }
  ).messages;

test('pre-search runs inside the generation, adds sources and a message after the system prompt', async () => {
  const order: string[] = [];
  const r = await run(
    [[text('ok'), stop]],
    {
      request: { model: 'm', messages: preMessages } as never,
      preContext: {
        query: 'btc?',
        run: async (q) => {
          order.push(`search:${q}`);
          return preResults;
        },
      },
    },
    (g) => g.subscribe((e) => e.type === 'activity' && order.push(`activity:${e.kind}`)),
  );
  expect(order).toEqual(['activity:searching', 'search:btc?', 'activity:idle']);
  const sent = sentMessages(r);
  expect(sent.map((m) => m.role)).toEqual(['system', 'system', 'user']);
  expect(sent[1]?.content).toContain('untrusted data, not instructions');
  const added = r.events.filter((e) => e.type === 'sources.added');
  expect(added).toHaveLength(1);
  expect(r.stored.parts.at(-1)).toMatchObject({ type: 'sources' });
  const types = r.events.map((e) => e.type);
  expect(types.lastIndexOf('activity')).toBeLessThan(types.indexOf('text.delta'));
});

test('a failing pre-search is skipped and the answer still comes', async () => {
  const r = await run([[text('ok'), stop]], {
    request: { model: 'm', messages: preMessages } as never,
    preContext: {
      query: 'q',
      run: async () => {
        throw new Error('down');
      },
    },
  });
  expect(r.stored.status).toBe('complete');
  expect(sentMessages(r)).toHaveLength(2);
  const kinds = r.events.flatMap((e) => (e.type === 'activity' ? [e.kind] : []));
  expect(kinds).toEqual(['searching', 'idle']);
});

test('a pre-search that never answers is cut off by its own timeout', async () => {
  const r = await run(
    [[text('ok'), stop]],
    {
      request: { model: 'm', messages: preMessages } as never,
      preContext: {
        query: 'q',
        run: (_q, signal) =>
          new Promise((_res, rej) =>
            signal.addEventListener('abort', () => rej(new Error('late'))),
          ),
      },
    },
    undefined,
    { preSearchTimeoutMs: 5 },
  );
  expect(r.stored.status).toBe('complete');
  expect(sentMessages(r)).toHaveLength(2);
  expect(sentMessages(r).some((m) => m.content.includes('untrusted data'))).toBe(false);
});

test('a generation stopped during pre-search ends aborted, with no warning and no model call', async () => {
  const warn = vi.fn();
  const r = await run(
    [[text('never'), stop]],
    {
      request: { model: 'm', messages: preMessages } as never,
      preContext: {
        query: 'q',
        run: (_q, signal) =>
          new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error('x')))),
      },
    },
    (g) => setTimeout(() => g.abort('user'), 5),
    { log: { error: vi.fn(), warn, info: vi.fn() } as never },
  );
  expect(r.stored.status).toBe('aborted');
  expect(r.streamChat).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
});
