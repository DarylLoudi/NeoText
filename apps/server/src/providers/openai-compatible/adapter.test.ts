import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  type MockProvider,
  type MockScript,
  startMockProvider,
} from '../../../test-support/mock-provider';
import { chunk, DONE, finish, fixtureFrames, textFrames } from '../../../test-support/sse-frames';
import { createHttpClient, type HttpClient } from '../../net/http-client';
import type { ChatRequest, ProviderEvent, ResolvedProvider } from '../types';
import { createOpenAICompatibleAdapter } from './adapter';
import { toRequestBody } from './request';
import { streamChatCompletions } from './stream';

const adapter = createOpenAICompatibleAdapter();
const baseReq: ChatRequest = { model: 'm', messages: [{ role: 'user', content: 'hi' }] };

let mock: MockProvider;
let http: HttpClient;
let blockedHttp: HttpClient;
let p: ResolvedProvider;

beforeAll(async () => {
  mock = await startMockProvider();
  http = createHttpClient({ allowPrivate: true });
  blockedHttp = createHttpClient({ allowPrivate: false });
});
afterAll(async () => {
  await http.close();
  await blockedHttp.close();
  await mock.close();
});
beforeEach(() => {
  mock.reset();
  mock.models = [];
  p = {
    id: 'p1',
    kind: 'openai-compatible',
    baseUrl: mock.url,
    apiKey: 'k',
    headers: { 'x-custom': 'yes' },
    manualModels: [],
    http,
    appUrl: 'http://localhost:3000',
  };
});

type Frames = NonNullable<MockScript['frames']>;
const collect = async (gen: AsyncGenerator<ProviderEvent>) => {
  const evs: ProviderEvent[] = [];
  for await (const e of gen) evs.push(e);
  return evs;
};
const run = async (frames: Frames, req = baseReq, opts?: Omit<MockScript, 'frames'>) => {
  mock.enqueue({ frames, ...opts });
  return collect(adapter.streamChat(p, req, new AbortController().signal));
};
const textOf = (evs: ProviderEvent[]) =>
  evs.flatMap((e) => (e.type === 'text' ? [e.text] : [])).join('');
const reasoningOf = (evs: ProviderEvent[]) =>
  evs.flatMap((e) => (e.type === 'reasoning' ? [e.text] : [])).join('');

describe('streaming', () => {
  test('text, usage and a single finish', async () => {
    const evs = await run(textFrames('Halo! ', 'Apa kabar?'));
    expect(textOf(evs)).toBe('Halo! Apa kabar?');
    expect(evs.filter((e) => e.type === 'finish')).toEqual([{ type: 'finish', reason: 'stop' }]);
    expect(evs.find((e) => e.type === 'usage')).toMatchObject({
      usage: { promptTokens: 12, completionTokens: 5, costUsd: null },
    });
    expect(mock.requests[0]?.headers.authorization).toBe('Bearer k');
    expect(mock.requests[0]?.headers['x-custom']).toBe('yes');
    expect(mock.requests[0]?.path).toBe('/v1/chat/completions');
    expect(mock.requests[0]?.body).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  test('no Authorization header without a key', async () => {
    p = { ...p, apiKey: null };
    await run(textFrames('x'));
    expect(mock.requests[0]?.headers.authorization).toBeUndefined();
  });

  test('parallel tool calls are assembled per index', async () => {
    const evs = await run(fixtureFrames('openrouter-tools'));
    expect(evs.filter((e) => e.type === 'tool_call_start')).toEqual([
      {
        type: 'tool_call_start',
        index: 0,
        id: 'call_441c517e23d549ca8453b6bf',
        name: 'get_weather',
      },
      {
        type: 'tool_call_start',
        index: 1,
        id: 'call_05d6db8ea6b94474acc031e4',
        name: 'get_weather',
      },
    ]);
    const args = (i: number) =>
      evs.flatMap((e) => (e.type === 'tool_call_delta' && e.index === i ? [e.args] : [])).join('');
    expect(JSON.parse(args(0))).toEqual({ city: 'Jakarta' });
    expect(JSON.parse(args(1))).toEqual({ city: 'Bandung' });
    expect(evs.filter((e) => e.type === 'finish')).toEqual([
      { type: 'finish', reason: 'tool_calls' },
    ]);
  });

  test('search recording yields processing, citations and the generation id once', async () => {
    const evs = await run(fixtureFrames('openrouter-search'), baseReq, {
      headers: { 'x-generation-id': 'gen-header' },
    });
    expect(evs.filter((e) => e.type === 'processing')).toHaveLength(1);
    expect(evs.filter((e) => e.type === 'citation')).toHaveLength(3);
    expect(evs.filter((e) => e.type === 'meta' && e.generationRef !== undefined)).toEqual([
      { type: 'meta', generationRef: 'gen-header' },
    ]);
  });

  test('<think> tags become reasoning', async () => {
    const evs = await run([
      chunk({ content: '<thi' }),
      chunk({ content: 'nk>hmm' }),
      chunk({ content: '</th' }),
      chunk({ content: 'ink>Jawabannya 42.' }),
      finish('stop'),
      DONE,
    ]);
    expect(reasoningOf(evs)).toBe('hmm');
    expect(textOf(evs)).toBe('Jawabannya 42.');
  });

  test('reasoning_content is reasoning', async () => {
    const evs = await run([chunk({ reasoning_content: 'step' }), finish('stop'), DONE]);
    expect(evs).toContainEqual({ type: 'reasoning', text: 'step' });
  });

  test('mid-stream error chunk', async () => {
    const evs = await run(fixtureFrames('openrouter-error'));
    expect(textOf(evs)).toBe('Partial ');
    expect(evs.find((e) => e.type === 'error')).toMatchObject({
      error: { code: 'upstream', message: 'Provider disconnected unexpectedly' },
    });
  });

  test('utf-8 split across chunks', async () => {
    const frame = new TextEncoder().encode(chunk({ content: 'Selamat 🌏 pagi' }));
    const cut = frame.indexOf(0xf0) + 1;
    const evs = await run([frame.slice(0, cut), frame.slice(cut), finish('stop'), DONE]);
    expect(textOf(evs)).toBe('Selamat 🌏 pagi');
  });

  test('five unparsable data lines in a row are a bad_response', async () => {
    const junk = Array.from({ length: 5 }, () => 'data: {oops\n\n');
    await expect(run(junk)).rejects.toMatchObject({ code: 'bad_response' });
  });

  test('a few unparsable lines are skipped', async () => {
    const evs = await run(['data: {oops\n\n', ...textFrames('ok')]);
    expect(textOf(evs)).toBe('ok');
  });
});

describe('errors', () => {
  test.each([
    [401, 'auth', false],
    [402, 'insufficient_credits', false],
    [404, 'model_not_found', false],
    [503, 'upstream', true],
  ])('HTTP %i maps to %s', async (status, code, retryable) => {
    await expect(
      run([], baseReq, {
        status,
        body: JSON.stringify({ error: { message: 'nope', code: status } }),
      }),
    ).rejects.toMatchObject({ code, retryable });
  });

  test('429 carries retry-after', async () => {
    await expect(
      run([], baseReq, {
        status: 429,
        headers: { 'retry-after': '2' },
        body: JSON.stringify({ error: { message: 'slow down' } }),
      }),
    ).rejects.toMatchObject({ code: 'rate_limit', retryAfterMs: 2000 });
  });

  test('html instead of a stream', async () => {
    await expect(
      run([], baseReq, { headers: { 'content-type': 'text/html' }, body: '<html>Not here</html>' }),
    ).rejects.toMatchObject({ code: 'bad_response', message: expect.stringContaining('/v1') });
  });

  test('a 404 HTML page on chat points at the base URL', async () => {
    const html = '<!doctype html><html><body><h1>404 Not Found</h1></body></html>';
    const err = await run([], baseReq, {
      status: 404,
      headers: { 'content-type': 'text/html' },
      body: html,
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'bad_response', message: expect.stringContaining('/v1') });
    expect((err as Error).message).not.toContain('<');
  });

  test('a JSON body with a null error is not an error object', async () => {
    await expect(run([], baseReq, { body: '{"error":null}' })).rejects.toMatchObject({
      code: 'bad_response',
    });
  });

  test('a plain JSON completion still works', async () => {
    const body = JSON.stringify({
      id: 'gen-json',
      choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const evs = await run([], baseReq, { body });
    expect(textOf(evs)).toBe('Hi');
    expect(evs.filter((e) => e.type === 'finish')).toEqual([{ type: 'finish', reason: 'stop' }]);
    expect(evs.some((e) => e.type === 'usage')).toBe(true);
  });

  test('a blocked address is a bad_request, not a network error', async () => {
    p = { ...p, baseUrl: mock.url.replace('127.0.0.1', 'localhost'), http: blockedHttp };
    await expect(run([])).rejects.toMatchObject({
      code: 'bad_request',
      message: 'This address is not allowed for this endpoint.',
    });
    p = { ...p, baseUrl: mock.url, http: blockedHttp };
    await expect(run([])).rejects.toMatchObject({ code: 'bad_request' });
  });

  test('an unreachable endpoint is a network error', async () => {
    p = { ...p, baseUrl: 'http://127.0.0.1:1/v1' };
    await expect(run([])).rejects.toMatchObject({ code: 'network' });
  });
});

describe('lifecycle', () => {
  const opts = { headers: {}, splitThinkTags: true };

  test('idle stream times out and releases the connection', async () => {
    mock.enqueue({ frames: [chunk({ content: 'a' })], hangAfterFrames: true });
    const gen = streamChatCompletions(
      p,
      toRequestBody(baseReq, 'openai'),
      new AbortController().signal,
      { ...opts, idleTimeoutMs: 200 },
    );
    const seen: ProviderEvent[] = [];
    await expect(
      (async () => {
        for await (const e of gen) seen.push(e);
      })(),
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(textOf(seen)).toBe('a');
    await vi.waitFor(() => expect(mock.openChats()).toBe(0));
  });

  test('abort ends the stream', async () => {
    mock.enqueue({ frames: [chunk({ content: 'a' })], hangAfterFrames: true });
    const ac = new AbortController();
    const gen = adapter.streamChat(p, baseReq, ac.signal);
    await expect(
      (async () => {
        for await (const e of gen) if (e.type === 'text') ac.abort();
      })(),
    ).rejects.toMatchObject({ code: 'aborted' });
    await vi.waitFor(() => expect(mock.openChats()).toBe(0));
  });

  test('an already aborted signal never reaches the network', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(collect(adapter.streamChat(p, baseReq, ac.signal))).rejects.toMatchObject({
      code: 'aborted',
    });
    expect(mock.requests).toHaveLength(0);
  });

  test('breaking out early closes the upstream request', async () => {
    mock.enqueue({ frames: [chunk({ content: 'a' })], hangAfterFrames: true });
    for await (const e of adapter.streamChat(p, baseReq, new AbortController().signal)) {
      if (e.type === 'text') break;
    }
    await vi.waitFor(() => expect(mock.openChats()).toBe(0));
  });
});

describe('models', () => {
  test('model list merges manual models without duplicates', async () => {
    mock.models = ['a', 'b'];
    p = { ...p, manualModels: ['b', 'c'] };
    const list = await adapter.listModels(p);
    expect(list.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(list[0]).toMatchObject({
      providerId: 'p1',
      name: 'a',
      supports: { tools: null, webSearch: false },
      // The endpoint does not say what a model reads: unknown, not text only.
      inputModalities: [],
    });
    expect(mock.requests[0]?.headers.authorization).toBe('Bearer k');
  });

  test('test() reports latency and model count', async () => {
    mock.models = ['a', 'b'];
    expect(await adapter.test(p)).toMatchObject({ ok: true, modelCount: 2 });
  });

  test('a 404 model list falls back to manual models', async () => {
    p = { ...p, baseUrl: `${mock.url}/nothing-here`, manualModels: ['x'] };
    expect((await adapter.listModels(p)).map((m) => m.id)).toEqual(['x']);
    expect(await adapter.test(p)).toMatchObject({ ok: true, modelCount: null });
  });

  test('test() on a 404 model list without manual models points at the base URL', async () => {
    p = { ...p, baseUrl: `${mock.url}/nothing-here` };
    const r = await adapter.test(p);
    expect(r).toMatchObject({ ok: false, code: 'bad_response' });
    expect(r.ok === false && r.message).toContain('/v1');
  });

  test('test() reports failures as a result, not a throw', async () => {
    p = { ...p, baseUrl: 'http://127.0.0.1:1/v1' };
    expect(await adapter.test(p)).toMatchObject({ ok: false, code: 'network' });
  });

  test('warm swallows failures and hits /models', async () => {
    await adapter.warm(p);
    expect(mock.requests.at(-1)?.path).toBe('/v1/models');
    p = { ...p, baseUrl: 'http://127.0.0.1:1/v1' };
    await expect(adapter.warm(p)).resolves.toBeUndefined();
  });
});
