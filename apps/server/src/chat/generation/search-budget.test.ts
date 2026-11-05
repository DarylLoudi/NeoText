import { expect, test, vi } from 'vitest';
import {
  call,
  callStep,
  echo,
  lastMessages,
  run,
  stop,
  text,
  tool,
  toolCalls,
} from '../../../test-support/tool-harness';
import type { ChatRequest, ProviderEvent, ProviderUsage } from '../../providers/types';
import { createSearchBudget } from '../../search/budget';
import type { SearchBackend } from '../../search/types';
import { createWebSearchTool, SEARCH_LIMIT_REACHED } from '../../tools/builtin/web-search';
import { openRouterWebSearch } from './web-search';

const searched = (n: number): ProviderEvent => {
  const usage: ProviderUsage = {
    promptTokens: 1,
    completionTokens: 1,
    reasoningTokens: 0,
    cachedTokens: 0,
    costUsd: null,
    webSearchRequests: n,
  };
  return { type: 'usage', usage };
};
const citation = (url: string): ProviderEvent => ({
  type: 'citation',
  url,
  title: url,
  content: '',
});

function serverRequest(max: number): ChatRequest {
  return {
    model: 'm/1',
    messages: [{ role: 'user', content: 'hi' }],
    ...openRouterWebSearch({ maxSearchesPerTurn: max }),
  };
}

test('server searches count across the turn and the web plugin goes once they are spent', async () => {
  const r = await run(
    [
      [searched(2), ...callStep('c1', 'echo', '{"q":"1"}')],
      [searched(1), ...callStep('c2', 'echo', '{"q":"2"}')],
      [...callStep('c3', 'echo', '{"q":"3"}')],
      [text('Done'), stop],
    ],
    [echo()],
    { over: { request: serverRequest(3), searchBudget: createSearchBudget(3) } },
  );
  expect(r.final.status).toBe('complete');
  expect(r.requests.map((q) => q.maxServerToolCalls)).toEqual([3, 1, undefined, undefined]);
  expect(r.requests.map((q) => (q.serverTools ?? []).length)).toEqual([1, 1, 0, 0]);
  // The function tools stay; only the search goes.
  expect(r.requests[2]?.tools?.map((t) => t.name)).toEqual(['echo']);
});

test('a step whose usage reports no searches but brings citations counts as one search', async () => {
  const r = await run(
    [
      [citation('https://a.example/'), ...callStep('c1', 'echo', '{"q":"1"}')],
      [text('Done'), stop],
    ],
    [echo()],
    { over: { request: serverRequest(2), searchBudget: createSearchBudget(2) } },
  );
  expect(r.requests.map((q) => q.maxServerToolCalls)).toEqual([2, 1]);
});

test('app web_search stops at the per-turn limit, even when the model searches every step', async () => {
  const search = vi.fn<SearchBackend['search']>(async () => [
    { url: 'https://a.example/', title: 'A', snippet: 's' },
  ]);
  const budget = createSearchBudget(3);
  const webSearch = createWebSearchTool(
    { kind: 'searxng', search },
    { id: 'prv_s', kind: 'searxng' } as never,
    5,
    budget,
  );
  const searchStep = (id: string, extra: ProviderEvent[] = []) => [
    ...call(0, id, 'web_search', '{"query":"q"}'),
    ...extra,
    toolCalls,
  ];
  const r = await run(
    [
      // Two searches in one step, then one per step: the fourth and later are refused.
      [
        ...call(0, 'a1', 'web_search', '{"query":"q"}'),
        ...call(1, 'a2', 'web_search', '{"query":"q"}'),
        toolCalls,
      ],
      searchStep('b1'),
      searchStep('c1'),
      searchStep('d1'),
      [text('Done'), stop],
    ],
    [webSearch, echo()],
    { over: { searchBudget: budget } },
  );
  expect(search).toHaveBeenCalledTimes(3);
  expect(lastMessages(r.requests[3] as ChatRequest, 1)[0]).toEqual({
    role: 'tool',
    toolCallId: 'c1',
    content: SEARCH_LIMIT_REACHED,
  });
  // Once nothing is left, the search tool is no longer offered.
  expect(r.requests[3]?.tools?.map((t) => t.name)).toEqual(['echo']);
  expect(r.final.status).toBe('complete');
});

test('a refused app search never reaches the backend', async () => {
  const search = vi.fn<SearchBackend['search']>(async () => []);
  const budget = createSearchBudget(0);
  const t = createWebSearchTool({ kind: 'searxng', search }, {} as never, 5, budget);
  const result = await t.execute({ query: 'x' }, {
    signal: new AbortController().signal,
  } as never);
  expect(result).toEqual({ ok: false, error: SEARCH_LIMIT_REACHED });
  expect(search).not.toHaveBeenCalled();
});

test('the budget never goes below zero', () => {
  const b = createSearchBudget(2);
  b.spend(5);
  expect(b.remaining()).toBe(0);
  expect(b.take()).toBe(false);
  const c = createSearchBudget(1);
  expect(c.take()).toBe(true);
  expect(c.take()).toBe(false);
});

test('tools that are not searches are untouched by the budget', async () => {
  const t = tool('lookup', async () => ({ ok: true, content: 'x' }));
  const r = await run([callStep('c1', 'lookup', '{}'), [text('ok'), stop]], [t], {
    over: { searchBudget: createSearchBudget(0) },
  });
  expect(r.requests[0]?.tools?.map((d) => d.name)).toEqual(['lookup']);
});
