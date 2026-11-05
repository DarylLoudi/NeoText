import { describe, expect, test, vi } from 'vitest';
import type { ResolvedProvider } from '../../providers/types';
import { type SearchBackend, SearchError } from '../../search/types';
import type { ToolContext } from '../types';
import { createWebSearchTool } from './web-search';

const provider = { id: 'prv_s', kind: 'searxng' } as ResolvedProvider;
const ctx = (signal = new AbortController().signal): ToolContext =>
  ({ userId: 'u', timeZone: 'UTC', signal, log: { info: vi.fn() } }) as unknown as ToolContext;

const backend = (search: SearchBackend['search']): SearchBackend => ({ kind: 'searxng', search });

test('describes itself and defaults to auto', () => {
  const tool = createWebSearchTool(
    backend(async () => []),
    provider,
    5,
  );
  expect(tool).toMatchObject({
    name: 'web_search',
    description: 'Search the web for current information. Use short keyword queries.',
    source: 'app',
    defaultPolicy: 'auto',
    parameters: { type: 'object', required: ['query'] },
  });
});

test('numbers results and returns sources', async () => {
  const search = vi.fn<SearchBackend['search']>(async () => [
    { url: 'https://a.example/', title: 'Alpha', snippet: 'First snippet' },
    { url: 'https://b.example/', title: 'Beta', snippet: 'Second snippet' },
  ]);
  const tool = createWebSearchTool(backend(search), provider, 7);
  const result = await tool.execute({ query: ' neotext ' }, ctx());
  expect(result).toEqual({
    ok: true,
    content:
      '[1] Alpha — https://a.example/\nFirst snippet\n\n[2] Beta — https://b.example/\nSecond snippet',
    sources: [
      { url: 'https://a.example/', title: 'Alpha', content: 'First snippet' },
      { url: 'https://b.example/', title: 'Beta', content: 'Second snippet' },
    ],
  });
  expect(search).toHaveBeenCalledWith(provider, 'neotext', {
    count: 7,
    signal: expect.any(AbortSignal),
  });
});

test('no results is a successful, plain answer', async () => {
  const tool = createWebSearchTool(
    backend(async () => []),
    provider,
    5,
  );
  expect(await tool.execute({ query: 'zzz' }, ctx())).toEqual({
    ok: true,
    content: 'No results found.',
    sources: [],
  });
});

test('a missing query is a tool error', async () => {
  const tool = createWebSearchTool(
    backend(async () => []),
    provider,
    5,
  );
  expect(await tool.execute({}, ctx())).toEqual({
    ok: false,
    error: 'Give the search words as "query".',
  });
});

describe('failures become a tool error', () => {
  const failing = (err: Error) =>
    createWebSearchTool(
      backend(async () => {
        throw err;
      }),
      provider,
      5,
    );

  test('rate limit', async () => {
    const tool = failing(new SearchError('slow down', 429));
    expect(await tool.execute({ query: 'x' }, ctx())).toEqual({
      ok: false,
      error:
        'Search is unavailable right now (rate limited). Answer from what you know and say so.',
    });
  });

  test('network failure', async () => {
    const r = await failing(new TypeError('fetch failed')).execute({ query: 'x' }, ctx());
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('Search is unavailable') });
    expect(JSON.stringify(r)).not.toContain('fetch failed');
  });

  test('stopped generation', async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await failing(new Error('aborted')).execute({ query: 'x' }, ctx(ac.signal));
    expect(r).toEqual({ ok: false, error: 'This request was stopped.' });
  });
});
