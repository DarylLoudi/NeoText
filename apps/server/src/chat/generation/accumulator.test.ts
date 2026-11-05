import { describe, expect, test } from 'vitest';
import { fixtureFrames } from '../../../test-support/sse-frames';
import { createFakeClock } from '../../lib/clock';
import { createChunkMapper } from '../../providers/openai-compatible/chunk-mapper';
import type { ProviderEvent, ProviderUsage } from '../../providers/types';
import { createAccumulator } from './accumulator';

function mapFixture(name: string): ProviderEvent[] {
  const mapper = createChunkMapper({ splitThinkTags: false });
  const out: ProviderEvent[] = [];
  for (const frame of fixtureFrames(name)) {
    // Comment frames carry the OpenRouter keep-alive that stream.ts turns into `processing`.
    if (frame.includes('PROCESSING')) out.push({ type: 'processing' });
    const data = frame
      .split('\n')
      .find((l) => l.startsWith('data: '))
      ?.slice(6);
    if (data === undefined || data === '[DONE]') continue;
    out.push(...mapper.map(JSON.parse(data)));
  }
  return [...out, ...mapper.flush()];
}

const usage = (p: number, c: number, cost: number | null): ProviderUsage => ({
  promptTokens: p,
  completionTokens: c,
  reasoningTokens: 1,
  cachedTokens: 0,
  costUsd: cost,
  webSearchRequests: 0,
});

describe('accumulator', () => {
  test('search recording becomes reasoning, text and two sources', () => {
    const clock = createFakeClock();
    const acc = createAccumulator({ clock, webSearch: true });
    const out = mapFixture('openrouter-search').flatMap((e) => acc.apply(e));
    expect(acc.parts().map((p) => p.type)).toEqual(['reasoning', 'text', 'sources']);
    const sources = (acc.parts()[2] as { sources: { n: number }[] }).sources;
    expect(sources.map((s) => s.n)).toEqual([1, 2]);
    const kinds = out.filter((e) => e.type === 'activity').map((e) => (e as { kind: string }).kind);
    expect(kinds).toEqual(['searching', 'idle']);
    expect(out.some((e) => e.type === 'reasoning.done')).toBe(true);
    expect(out.filter((e) => e.type === 'sources.added')).toHaveLength(2);
    const reasoning = acc.parts()[0] as { durationMs: number | null };
    expect(reasoning.durationMs).not.toBeNull();
    expect(acc.finishReason()).toBe('stop');
    expect(acc.meta().upstreamProvider).toBe('Wafer');
    expect(acc.meta().generationRef).toMatch(/^gen-/);
    expect(acc.hasOutput()).toBe(true);
  });

  test('usage sums across steps', () => {
    const acc = createAccumulator({ clock: createFakeClock(), webSearch: false });
    acc.apply({ type: 'usage', usage: usage(10, 5, 0.001) });
    acc.beginStep();
    const out = acc.apply({ type: 'usage', usage: usage(20, 7, 0.002) });
    expect(acc.usage()).toMatchObject({
      promptTokens: 30,
      completionTokens: 12,
      reasoningTokens: 2,
    });
    expect(acc.usage()?.costUsd).toBeCloseTo(0.003);
    expect(out[0]).toMatchObject({
      type: 'usage',
      usage: { promptTokens: 30, completionTokens: 12 },
    });
  });

  test("the context is the last model call's prompt and output, not the sum", () => {
    const acc = createAccumulator({ clock: createFakeClock(), webSearch: false });
    expect(acc.contextTokens()).toBeNull();
    acc.apply({ type: 'usage', usage: usage(40_000, 50, null) });
    acc.beginStep();
    const out = acc.apply({ type: 'usage', usage: usage(41_000, 900, null) });
    expect(acc.contextTokens()).toBe(41_900);
    expect(out[0]).toMatchObject({ type: 'usage', usage: { contextTokens: 41_900 } });
    // A step that reports nothing keeps the last known figure.
    acc.beginStep();
    expect(acc.contextTokens()).toBe(41_900);
  });

  test('cost stays null when no step reports one', () => {
    const acc = createAccumulator({ clock: createFakeClock(), webSearch: false });
    acc.apply({ type: 'usage', usage: usage(1, 1, null) });
    expect(acc.usage()?.costUsd).toBeNull();
  });

  test('tool calls assemble per step', () => {
    const acc = createAccumulator({ clock: createFakeClock(), webSearch: false });
    for (const e of mapFixture('openrouter-tools')) acc.apply(e);
    const calls = acc.toolCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ name: 'get_weather', arguments: '{"city": "Jakarta"}' });
    expect(calls[0]?.id).toMatch(/^call_441/);
    expect(calls[1]?.arguments).toContain('Bandung');
    expect(acc.finishReason()).toBe('tool_calls');
    acc.beginStep();
    expect(acc.toolCalls()).toEqual([]);
    expect(acc.reasoningDetails()).toEqual([]);
  });

  test('text and reasoning append to the last matching part', () => {
    const clock = createFakeClock();
    const acc = createAccumulator({ clock, webSearch: false });
    acc.apply({ type: 'reasoning', text: 'a' });
    acc.apply({ type: 'reasoning', text: 'b' });
    clock.advance(250);
    const out = acc.apply({ type: 'text', text: 'x' });
    acc.apply({ type: 'text', text: 'y' });
    expect(out.map((e) => e.type)).toEqual(['reasoning.done', 'text.delta']);
    expect(out[0]).toMatchObject({ durationMs: 250 });
    expect(acc.parts()).toEqual([
      { type: 'reasoning', text: 'ab', durationMs: 250 },
      { type: 'text', text: 'xy' },
    ]);
  });

  test('reasoning is closed at finish and firstTokenAt is the first output', () => {
    const clock = createFakeClock();
    const acc = createAccumulator({ clock, webSearch: false });
    expect(acc.firstTokenAt()).toBeNull();
    expect(acc.hasOutput()).toBe(false);
    clock.advance(100);
    const t = clock.now();
    acc.apply({ type: 'reasoning', text: 'think' });
    clock.advance(400);
    const out = acc.apply({ type: 'finish', reason: 'length' });
    expect(acc.firstTokenAt()).toBe(t);
    expect(out).toEqual([{ type: 'reasoning.done', durationMs: 400 }]);
    expect(acc.finishReason()).toBe('length');
  });

  test('processing without web search is plain processing', () => {
    const acc = createAccumulator({ clock: createFakeClock(), webSearch: false });
    expect(acc.apply({ type: 'processing' })).toEqual([{ type: 'activity', kind: 'processing' }]);
    expect(acc.apply({ type: 'processing' })).toEqual([]);
  });

  test('sources stay last when text follows them', () => {
    const acc = createAccumulator({ clock: createFakeClock(), webSearch: true });
    acc.apply({ type: 'citation', url: 'https://a.example/x', title: 'A', content: 'c' });
    acc.apply({ type: 'text', text: 'late' });
    expect(acc.parts().map((p) => p.type)).toEqual(['text', 'sources']);
  });

  test('a tool call or citation after reasoning closes the reasoning', () => {
    for (const next of [
      { type: 'tool_call_start', index: 0, id: 'c1', name: 'f' } as const,
      { type: 'citation', url: 'https://a.example/x', title: 'A', content: 'c' } as const,
    ]) {
      const clock = createFakeClock();
      const acc = createAccumulator({ clock, webSearch: false });
      acc.apply({ type: 'reasoning', text: 'think' });
      clock.advance(300);
      const out = acc.apply(next);
      expect(out.filter((e) => e.type === 'reasoning.done')).toEqual([
        { type: 'reasoning.done', durationMs: 300 },
      ]);
      expect(acc.apply({ type: 'finish', reason: 'stop' })).toEqual([]);
    }
  });

  test('reasoning details are merged for replay', () => {
    const acc = createAccumulator({ clock: createFakeClock(), webSearch: false });
    acc.apply({
      type: 'reasoning_details',
      details: [{ type: 'reasoning.text', text: 'We', index: 0, format: 'anthropic-claude-v1' }],
    });
    acc.apply({
      type: 'reasoning_details',
      details: [{ type: 'reasoning.text', text: ' need', index: 0 }],
    });
    acc.apply({
      type: 'reasoning_details',
      details: [
        { type: 'reasoning.text', text: '', index: 0, signature: 'sig' },
        { type: 'reasoning.encrypted', data: 'x', index: 1 },
        { type: 'reasoning.summary', summary: 'S', index: 2, id: 'r1' },
        { type: 'reasoning.summary', summary: 'T', index: 2 },
      ],
    });
    expect(acc.reasoningDetails()).toEqual([
      {
        type: 'reasoning.text',
        text: 'We need',
        index: 0,
        format: 'anthropic-claude-v1',
        signature: 'sig',
      },
      { type: 'reasoning.encrypted', data: 'x', index: 1 },
      { type: 'reasoning.summary', summary: 'ST', index: 2, id: 'r1' },
    ]);
  });

  test('tool call parts sit between text parts and update in place', () => {
    const clock = createFakeClock();
    const acc = createAccumulator({ clock, webSearch: false });
    acc.apply({ type: 'text', text: 'Checking.' });
    const part = {
      type: 'tool_call' as const,
      id: 'c1',
      name: 'echo',
      source: 'app' as const,
      args: '{}',
      status: 'running' as const,
      result: null,
      startedAt: clock.now(),
      finishedAt: null,
    };
    expect(acc.addToolCall(part)).toEqual([{ type: 'tool.started', call: part }]);
    expect(acc.updateToolCall('c1', { status: 'ok', result: 'r', finishedAt: 5 })).toEqual([
      { type: 'tool.updated', call: { ...part, status: 'ok', result: 'r', finishedAt: 5 } },
    ]);
    expect(acc.updateToolCall('missing', { status: 'ok' })).toEqual([]);
    acc.apply({ type: 'text', text: 'Done.' });
    expect(acc.parts().map((p) => p.type)).toEqual(['text', 'tool_call', 'text']);
    expect(acc.hasOutput()).toBe(true);
  });

  test('step text and step output reset per step', () => {
    const acc = createAccumulator({ clock: createFakeClock(), webSearch: false });
    acc.apply({ type: 'text', text: 'a' });
    expect(acc.stepText()).toBe('a');
    expect(acc.stepHasOutput()).toBe(true);
    acc.apply({ type: 'finish', reason: 'tool_calls' });
    acc.beginStep();
    expect(acc.stepText()).toBe('');
    expect(acc.stepHasOutput()).toBe(false);
    expect(acc.finishReason()).toBeNull();
    expect(acc.hasOutput()).toBe(true);
  });

  test('added sources are deduplicated with citations', () => {
    const acc = createAccumulator({ clock: createFakeClock(), webSearch: false });
    acc.apply({ type: 'citation', url: 'https://a.example/x', title: 'A', content: 'c' });
    const out = acc.addSources([
      { url: 'http://www.a.example/x/', title: 'A again', content: 'c' },
      { url: 'https://b.example/', title: 'B', content: 'b' },
    ]);
    expect(out).toEqual([
      { type: 'sources.added', sources: [expect.objectContaining({ n: 2, domain: 'b.example' })] },
    ]);
    expect(acc.addSources([{ url: 'https://b.example', title: 'B', content: '' }])).toEqual([]);
  });

  test('a repeated tool_call_start keeps the arguments so far', () => {
    const acc = createAccumulator({ clock: createFakeClock(), webSearch: false });
    acc.apply({ type: 'tool_call_start', index: 0, id: 'c1', name: 'echo' });
    acc.apply({ type: 'tool_call_delta', index: 0, args: '{"q":' });
    acc.apply({ type: 'tool_call_start', index: 0, id: 'c9', name: 'other' });
    acc.apply({ type: 'tool_call_delta', index: 0, args: '"hi"}' });
    expect(acc.toolCalls()).toEqual([{ id: 'c1', name: 'echo', arguments: '{"q":"hi"}' }]);
  });

  test('a streamed tool call that was never run is not output', () => {
    const acc = createAccumulator({ clock: createFakeClock(), webSearch: false });
    acc.apply({ type: 'tool_call_start', index: 0, id: 'c1', name: 'echo' });
    acc.apply({ type: 'finish', reason: 'stop' });
    expect(acc.stepHasOutput()).toBe(true);
    expect(acc.hasOutput()).toBe(false);
  });

  test('step usage is per model call; the total is summed', () => {
    const acc = createAccumulator({ clock: createFakeClock(), webSearch: false });
    acc.apply({ type: 'usage', usage: usage(10, 5, 0.001) });
    expect(acc.stepUsage()?.promptTokens).toBe(10);
    acc.beginStep();
    expect(acc.stepUsage()).toBeNull();
    acc.apply({ type: 'usage', usage: usage(20, 7, null) });
    expect(acc.stepUsage()).toMatchObject({ promptTokens: 20, costUsd: null });
    expect(acc.usage()).toMatchObject({ promptTokens: 30, costUsd: 0.001 });
  });
});
