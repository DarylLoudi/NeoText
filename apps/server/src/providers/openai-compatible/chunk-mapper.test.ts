import { describe, expect, test } from 'vitest';
import { fixtureFrames } from '../../../test-support/sse-frames';
import type { ProviderEvent } from '../types';
import { createChunkMapper } from './chunk-mapper';

function mapFixture(name: string, splitThinkTags = false): ProviderEvent[] {
  const mapper = createChunkMapper({ splitThinkTags });
  const out: ProviderEvent[] = [];
  for (const frame of fixtureFrames(name)) {
    const data = frame
      .split('\n')
      .find((l) => l.startsWith('data: '))
      ?.slice(6);
    if (data === undefined || data === '[DONE]') continue;
    out.push(...mapper.map(JSON.parse(data)));
  }
  return [...out, ...mapper.flush()];
}

describe('chunk mapper on the OpenRouter search recording', () => {
  const evs = mapFixture('openrouter-search');

  test('reasoning, citations, text, meta and one finish', () => {
    expect(evs.filter((e) => e.type === 'reasoning')).toEqual([
      { type: 'reasoning', text: "The user wants today's Bitcoin price. I'll search." },
    ]);
    expect(evs.filter((e) => e.type === 'citation')).toHaveLength(3);
    expect(evs.find((e) => e.type === 'citation')).toEqual({
      type: 'citation',
      url: 'https://bitcoinprice.corgano.com/',
      title: 'Bitcoin Price Today (Nov 2): $78,188',
      content:
        'Bitcoin is trading at $78,188 as of Nov 2, 2026, 05:15 UTC, up $423 (0.54%) over the past 24 hours.',
    });
    expect(evs.filter((e) => e.type === 'text')).toHaveLength(1);
    expect(evs.filter((e) => e.type === 'meta')).toEqual([
      { type: 'meta', upstreamProvider: 'Wafer' },
      { type: 'meta', generationRef: 'gen-1793701597-qb3L8izUqY4tbAOmb0XC' },
    ]);
    expect(evs.filter((e) => e.type === 'finish')).toEqual([{ type: 'finish', reason: 'stop' }]);
  });

  test('usage is normalised', () => {
    expect(evs.find((e) => e.type === 'usage')).toEqual({
      type: 'usage',
      usage: {
        promptTokens: 3707,
        completionTokens: 219,
        reasoningTokens: 158,
        cachedTokens: 768,
        costUsd: 0.001250971,
        webSearchRequests: 1,
      },
    });
  });
});

describe('chunk mapper on the tools recording', () => {
  test('reasoning details are forwarded and missing usage numbers default to 0', () => {
    const evs = mapFixture('openrouter-tools');
    expect(evs.find((e) => e.type === 'reasoning_details')).toEqual({
      type: 'reasoning_details',
      details: [{ type: 'reasoning.text', text: 'Need both cities.', format: 'unknown', index: 0 }],
    });
    expect(evs.find((e) => e.type === 'usage')).toMatchObject({
      usage: { reasoningTokens: 0, cachedTokens: 0, webSearchRequests: 0, costUsd: 0.000061175 },
    });
  });
});
