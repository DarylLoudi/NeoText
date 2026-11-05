import type { ToolCallPart } from '@neotext/shared';
import { expect, test } from 'vitest';
import { eventsFor, msg, source } from '../../../test/chat-fixtures';
import { applyStreamEvent } from './apply-event';

const empty = msg({ id: 'msg_a', status: 'streaming' });
const ev = () => eventsFor('gen_1', 2);

test('text appends to the last text part, reasoning stays first', () => {
  const e = ev();
  let m = empty;
  for (const x of [e.reasoning('hmm'), e.text('Ha'), e.text('lo')]) m = applyStreamEvent(m, x);
  expect(m.parts).toEqual([
    { type: 'reasoning', text: 'hmm', durationMs: null },
    { type: 'text', text: 'Halo' },
  ]);
});

test('sources stay last and accumulate', () => {
  const e = ev();
  let m = empty;
  for (const x of [e.text('a'), e.sources(source(1)), e.text('b'), e.sources(source(2))]) {
    m = applyStreamEvent(m, x);
  }
  expect(m.parts).toEqual([
    { type: 'text', text: 'ab' },
    { type: 'sources', sources: [source(1), source(2)] },
  ]);
});

test('snapshot replaces, finished replaces', () => {
  const e = ev();
  let m = applyStreamEvent(empty, e.text('old'));
  const snap = msg({ id: 'msg_a', status: 'streaming', parts: [{ type: 'text', text: 'Halo' }] });
  m = applyStreamEvent(m, e.snapshot(snap));
  expect(m).toEqual(snap);
  const final = msg({
    id: 'msg_a',
    status: 'complete',
    finishReason: 'stop',
    parts: [{ type: 'text', text: 'Halo dunia' }],
  });
  m = applyStreamEvent(m, e.finished(final));
  expect(m).toEqual(final);
});

test('reasoning.done sets the duration', () => {
  const e = ev();
  let m = applyStreamEvent(empty, e.reasoning('think'));
  m = applyStreamEvent(m, e.reasoningDone(12_000));
  m = applyStreamEvent(m, e.text('Answer'));
  expect(m.parts[0]).toEqual({ type: 'reasoning', text: 'think', durationMs: 12_000 });
});

test('reasoning after text starts a new part, as the server does', () => {
  const e = ev();
  let m = empty;
  for (const x of [e.text('a'), e.reasoning('r'), e.text('b')]) m = applyStreamEvent(m, x);
  expect(m.parts.map((p) => p.type)).toEqual(['text', 'reasoning', 'text']);
});

test('tool calls go before sources and update in place; usage is set', () => {
  const call: ToolCallPart = {
    type: 'tool_call',
    id: 'call_1',
    name: 'fetch_url',
    source: 'app',
    args: '{}',
    status: 'running',
    result: null,
    startedAt: 1,
    finishedAt: null,
  };
  let m = applyStreamEvent(empty, {
    type: 'sources.added',
    generationId: 'g',
    seq: 1,
    sources: [source(1)],
  });
  m = applyStreamEvent(m, { type: 'tool.started', generationId: 'g', seq: 2, call });
  m = applyStreamEvent(m, {
    type: 'tool.updated',
    generationId: 'g',
    seq: 3,
    call: { ...call, status: 'ok', result: 'done', finishedAt: 2 },
  });
  expect(m.parts.map((p) => p.type)).toEqual(['tool_call', 'sources']);
  expect(m.parts[0]).toMatchObject({ status: 'ok', result: 'done' });

  const usage = {
    promptTokens: 1,
    completionTokens: 2,
    reasoningTokens: 0,
    cachedTokens: 0,
    costUsd: 0.001,
    webSearchRequests: 0,
    ttftMs: null,
    durationMs: null,
    upstreamProvider: null,
  };
  m = applyStreamEvent(m, { type: 'usage', generationId: 'g', seq: 4, usage });
  expect(m.usage).toEqual(usage);
});

test('events that do not change the message return it as is', () => {
  const e = ev();
  expect(applyStreamEvent(empty, e.activity('searching'))).toBe(empty);
  expect(applyStreamEvent(empty, e.titled('cnv_1', 'Title'))).toBe(empty);
});

test('the moment of approval reaches the part, from events and from a snapshot', () => {
  const call: ToolCallPart = {
    type: 'tool_call',
    id: 'c1',
    name: 'fetch_url',
    source: 'app',
    args: '{}',
    status: 'awaiting_approval',
    result: null,
    startedAt: 100,
    finishedAt: null,
  };
  let m = applyStreamEvent(empty, { type: 'tool.started', generationId: 'g', seq: 1, call });
  m = applyStreamEvent(m, {
    type: 'tool.updated',
    generationId: 'g',
    seq: 2,
    call: { ...call, status: 'running', startedAt: 900 },
  });
  expect(m.parts[0]).toMatchObject({ status: 'running', startedAt: 900 });
  const resumed = applyStreamEvent(empty, {
    type: 'generation.snapshot',
    generationId: 'g',
    seq: 3,
    message: m,
  });
  expect(resumed.parts[0]).toMatchObject({ startedAt: 900 });
});

test('a repeated call id updates the latest row, as the server does', () => {
  const call: ToolCallPart = {
    type: 'tool_call',
    id: 'call_0',
    name: 'fetch_url',
    source: 'app',
    args: '{}',
    status: 'ok',
    result: 'step one',
    startedAt: 1,
    finishedAt: 2,
  };
  const later = { ...call, status: 'running' as const, result: null, finishedAt: null };
  const base = { ...empty, parts: [call, { type: 'text' as const, text: 'Then' }, later] };
  const m = applyStreamEvent(base, {
    type: 'tool.updated',
    generationId: 'g',
    seq: 1,
    call: { ...later, status: 'ok', result: 'step two', finishedAt: 3 },
  });
  expect(m.parts.map((p) => (p.type === 'tool_call' ? p.result : p.type))).toEqual([
    'step one',
    'text',
    'step two',
  ]);
});
