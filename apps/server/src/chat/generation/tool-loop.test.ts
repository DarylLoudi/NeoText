import type { ToolCallPart } from '@neotext/shared';
import { afterEach, expect, test, vi } from 'vitest';
import {
  awaiting,
  call,
  callStep,
  contextFor,
  echo,
  lastMessages,
  newGeneration,
  run,
  SUFFIX,
  start,
  stop,
  text,
  tool,
  toolCalls,
  toolParts,
  waitFor,
} from '../../../test-support/tool-harness';
import { createFakeClock } from '../../lib/clock';
import type { ChatRequest, ProviderEvent } from '../../providers/types';
import { assembleToolSet } from '../../tools/registry';
import { createAccumulator } from './accumulator';
import type { Generation } from './generation';
import {
  APPROVAL_TIMEOUT_MS,
  runToolCalls,
  TOOL_RESULT_MAX,
  TOOL_RESULT_STORED_MAX,
} from './tool-loop';

afterEach(() => {
  vi.useRealTimers();
});

test('runs a tool and feeds the result back', async () => {
  const t = echo();
  const r = await run([callStep('c1', 'echo', '{"q":"hi"}'), [text('Done'), stop]], [t]);
  expect(r.final.status).toBe('complete');
  expect(r.final.parts).toEqual([
    {
      type: 'tool_call',
      id: 'c1',
      name: 'echo',
      source: 'app',
      args: '{"q":"hi"}',
      status: 'ok',
      result: 'echo: hi',
      startedAt: expect.any(Number),
      finishedAt: expect.any(Number),
    },
    { type: 'text', text: 'Done' },
  ]);
  expect(r.requests[0]?.tools).toEqual([
    { name: 'echo', description: 'The echo tool.', parameters: { type: 'object' } },
  ]);
  expect(lastMessages(r.requests[1] as ChatRequest, 2)).toEqual([
    {
      role: 'assistant',
      content: null,
      toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"q":"hi"}' }],
    },
    { role: 'tool', toolCallId: 'c1', content: 'echo: hi' },
  ]);
  const kinds = r.events.filter((e) => e.type.startsWith('tool.'));
  expect(kinds.map((e) => [e.type, (e as { call: ToolCallPart }).call.status])).toEqual([
    ['tool.started', 'running'],
    ['tool.updated', 'ok'],
  ]);
});

test('step text and merged reasoning details are replayed', async () => {
  const details: ProviderEvent = {
    type: 'reasoning_details',
    details: [{ type: 'reasoning.text', text: 'Need', index: 0, format: 'x' }],
  };
  const more: ProviderEvent = {
    type: 'reasoning_details',
    details: [{ type: 'reasoning.text', text: ' it', index: 0, signature: 's' }],
  };
  const r = await run(
    [[details, more, text('Let me check.'), ...callStep('c1', 'echo', '{"q":"a"}')], [text('ok')]],
    [echo()],
  );
  expect(lastMessages(r.requests[1] as ChatRequest, 2)[0]).toEqual({
    role: 'assistant',
    content: 'Let me check.',
    toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"q":"a"}' }],
    reasoningDetails: [
      { type: 'reasoning.text', text: 'Need it', index: 0, format: 'x', signature: 's' },
    ],
  });
});

test('invalid JSON arguments go back to the model', async () => {
  const t = echo();
  const r = await run([callStep('c1', 'echo', '{"q":'), [text('Sorry'), stop]], [t]);
  expect(t.execute).not.toHaveBeenCalled();
  const toolMsg = lastMessages(r.requests[1] as ChatRequest, 1)[0] as { content: string };
  expect(toolMsg.content.startsWith('Tool arguments were not valid JSON: ')).toBe(true);
  expect(toolParts(r.final)[0]?.status).toBe('error');
  expect(r.final.status).toBe('complete');
  expect(r.final.parts.at(-1)).toEqual({ type: 'text', text: 'Sorry' });
});

test('unknown tools are reported to the model', async () => {
  const r = await run([callStep('c1', 'nope', '{}'), [text('ok'), stop]], [echo()]);
  expect(lastMessages(r.requests[1] as ChatRequest, 1)[0]).toMatchObject({
    content: 'Unknown tool: nope',
  });
  expect(toolParts(r.final)[0]).toMatchObject({ status: 'error', source: 'app' });
});

test('max steps forces an answer', async () => {
  const t = echo();
  const r = await run(
    [callStep('c1', 'echo', '{"q":"1"}'), callStep('c2', 'echo', '{"q":"2"}')],
    [t],
    { over: { maxSteps: 2 } },
  );
  expect(r.streamChat).toHaveBeenCalledTimes(2);
  expect(r.requests[0]?.tools).toHaveLength(1);
  expect('tools' in (r.requests[1] as ChatRequest)).toBe(false);
  expect(t.execute).toHaveBeenCalledTimes(1);
  expect(r.final.status).toBe('complete');
});

test('tool errors do not fail the turn', async () => {
  const t = tool('boom', async () => {
    throw new Error('Disk is on fire.');
  });
  const failed = tool('soft', async () => ({ ok: false, error: 'Nothing found.' }));
  const r = await run(
    [[...call(0, 'c1', 'boom', '{}'), ...call(1, 'c2', 'soft', '{}'), toolCalls], [text('Hmm')]],
    [t, failed],
  );
  expect(toolParts(r.final).map((p) => [p.status, p.result])).toEqual([
    ['error', 'Disk is on fire.'],
    ['error', 'Nothing found.'],
  ]);
  expect(lastMessages(r.requests[1] as ChatRequest, 2).map((m) => m.content)).toEqual([
    'Disk is on fire.',
    'Nothing found.',
  ]);
  expect(r.final.status).toBe('complete');
  expect(r.final.parts.at(-1)).toEqual({ type: 'text', text: 'Hmm' });
});

test('slow tools time out', async () => {
  const listens = tool(
    'listens',
    (_a, ctx) =>
      new Promise((_, reject) => {
        ctx.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    { timeoutMs: 50 },
  );
  const deaf = tool('deaf', () => new Promise(() => {}), { timeoutMs: 50 });
  const r = await run(
    [
      [...call(0, 'c1', 'listens', '{}'), ...call(1, 'c2', 'deaf', '{}'), toolCalls],
      [text('ok'), stop],
    ],
    [listens, deaf],
  );
  for (const p of toolParts(r.final)) {
    expect(p.status).toBe('error');
    expect(p.result).toContain('did not answer');
  }
  const tail = lastMessages(r.requests[1] as ChatRequest, 2);
  expect(tail.every((m) => String(m.content).includes('did not answer'))).toBe(true);
  expect(r.final.status).toBe('complete');
});

test('the default timeout is phrased in seconds', async () => {
  vi.useFakeTimers();
  const g = newGeneration();
  const acc = createAccumulator({ clock: createFakeClock(), webSearch: false });
  const pending = runToolCalls({
    calls: [{ id: 'c1', name: 'deaf', arguments: '{}' }],
    tools: assembleToolSet([tool('deaf', () => new Promise(() => {}))], {}),
    ctx: contextFor(g),
    generation: g,
    acc,
    clock: createFakeClock(),
    emit: () => {},
  });
  await vi.advanceTimersByTimeAsync(30_000);
  expect((await pending)[0]?.content).toBe('The tool did not answer within 30 seconds.');
});

test('results are truncated', async () => {
  const big = tool('big', async () => ({ ok: true, content: 'x'.repeat(20_000) }));
  const r = await run([callStep('c1', 'big', '{}'), [text('ok'), stop]], [big]);
  const toolMsg = lastMessages(r.requests[1] as ChatRequest, 1)[0] as { content: string };
  expect(toolMsg.content).toHaveLength(TOOL_RESULT_MAX + SUFFIX.length);
  expect(toolMsg.content.endsWith(SUFFIX)).toBe(true);
  const stored = toolParts(r.final)[0]?.result ?? '';
  expect(stored.length).toBeLessThanOrEqual(TOOL_RESULT_STORED_MAX);
  expect(stored.endsWith(SUFFIX)).toBe(true);
});

test('tool sources join the message sources', async () => {
  const src = { url: 'https://a.example/x', title: 'A', content: 'About <b>a</b>' };
  const read = tool('read', async () => ({ ok: true, content: 'page', sources: [src] }));
  const r = await run([callStep('c1', 'read', '{}'), [text('See [1]'), stop]], [read]);
  expect(r.final.parts.at(-1)).toMatchObject({
    type: 'sources',
    sources: [{ n: 1, url: src.url, domain: 'a.example', snippet: 'About <b>a</b>' }],
  });
  expect(r.events.filter((e) => e.type === 'sources.added')).toHaveLength(1);
});

test('parallel calls return in call order', async () => {
  const slow = tool('slow', async () => {
    await new Promise((res) => setTimeout(res, 30));
    return { ok: true, content: 'slow' };
  });
  const fast = tool('fast', async () => ({ ok: true, content: 'fast' }));
  const r = await run(
    [[...call(0, 'c1', 'slow', '{}'), ...call(1, 'c2', 'fast', '{}'), toolCalls], [text('ok')]],
    [slow, fast],
  );
  expect(lastMessages(r.requests[1] as ChatRequest, 2)).toEqual([
    { role: 'tool', toolCallId: 'c1', content: 'slow' },
    { role: 'tool', toolCallId: 'c2', content: 'fast' },
  ]);
});

test('ask waits for approval; allow runs', async () => {
  const t = echo();
  const s = start([callStep('c1', 'echo', '{"q":"hi"}'), [text('Done'), stop]], [t], {
    policies: { echo: 'ask' },
  });
  await waitFor(() => awaiting(s.generation));
  expect(t.execute).not.toHaveBeenCalled();
  expect(s.generation.resolveApproval('nope', 'allow')).toBe(false);
  expect(s.generation.resolveApproval('c1', 'allow')).toBe(true);
  const final = await s.finished;
  expect(t.execute).toHaveBeenCalledTimes(1);
  expect(toolParts(final)[0]).toMatchObject({ status: 'ok', result: 'echo: hi' });
  const statuses = s.events
    .filter((e) => e.type.startsWith('tool.'))
    .map((e) => (e as { call: ToolCallPart }).call.status);
  expect(statuses).toEqual(['awaiting_approval', 'running', 'ok']);
});

test('the wait for approval does not count towards the duration', async () => {
  const clock = createFakeClock();
  const g = newGeneration();
  const acc = createAccumulator({ clock, webSearch: false });
  const t = tool('echo', echo().execute, { defaultPolicy: 'ask' });
  const emitted: ToolCallPart[] = [];
  const asked = clock.now();
  const pending = runToolCalls({
    calls: [{ id: 'c1', name: 'echo', arguments: '{"q":"x"}' }],
    tools: assembleToolSet([t], {}),
    ctx: contextFor(g),
    generation: g,
    acc,
    clock,
    emit: (p) => {
      if (p.type === 'tool.started' || p.type === 'tool.updated') emitted.push(p.call);
    },
  });
  await waitFor(() => emitted[0]?.status === 'awaiting_approval');
  clock.advance(60_000);
  expect(g.resolveApproval('c1', 'allow')).toBe(true);
  await pending;
  expect(emitted[0]?.startedAt).toBe(asked);
  // The event that says it runs and the final one both carry the moment of approval.
  expect(emitted[1]).toMatchObject({ status: 'running', startedAt: asked + 60_000 });
  expect(emitted[2]).toMatchObject({ status: 'ok', startedAt: asked + 60_000 });
});

test('deny tells the model', async () => {
  const t = tool('echo', echo().execute, { defaultPolicy: 'ask' });
  const s = start([callStep('c1', 'echo', '{"q":"hi"}'), [text('Okay'), stop]], [t]);
  await waitFor(() => awaiting(s.generation));
  s.generation.resolveApproval('c1', 'deny');
  const final = await s.finished;
  expect(t.execute).not.toHaveBeenCalled();
  expect(toolParts(final)[0]).toMatchObject({
    status: 'denied',
    result: 'The user declined this tool call.',
  });
  expect(lastMessages(s.requests[1] as ChatRequest, 1)[0]).toMatchObject({
    content: 'The user declined this tool call.',
  });
  expect(final.status).toBe('complete');
});

test('approval that times out says so: the user did not decline', async () => {
  vi.useFakeTimers();
  const g = newGeneration();
  const acc = createAccumulator({ clock: createFakeClock(), webSearch: false });
  const t = tool('echo', echo().execute, { defaultPolicy: 'ask' });
  const pending = runToolCalls({
    calls: [{ id: 'c1', name: 'echo', arguments: '{"q":"x"}' }],
    tools: assembleToolSet([t], {}),
    ctx: contextFor(g),
    generation: g,
    acc,
    clock: createFakeClock(),
    emit: () => {},
  });
  await vi.advanceTimersByTimeAsync(APPROVAL_TIMEOUT_MS - 1);
  expect(acc.parts()[0]).toMatchObject({ status: 'awaiting_approval' });
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toEqual([
    {
      role: 'tool',
      toolCallId: 'c1',
      content: 'The approval request timed out with no answer, so this tool call did not run.',
    },
  ]);
  expect(acc.parts()[0]).toMatchObject({ status: 'no_answer' });
  expect(t.execute).not.toHaveBeenCalled();
});

test('abort during approval ends the turn', async () => {
  const t = tool('echo', echo().execute, { defaultPolicy: 'ask' });
  const s = start([callStep('c1', 'echo', '{"q":"hi"}'), [text('never'), stop]], [t]);
  await waitFor(() => awaiting(s.generation));
  s.generation.abort('user');
  const final = await s.finished;
  expect(final.status).toBe('aborted');
  expect(t.execute).not.toHaveBeenCalled();
  expect(s.streamChat).toHaveBeenCalledTimes(1);
  expect(toolParts(final)[0]?.status).toBe('error');
});

test('shutdown during a running tool ends interrupted', async () => {
  let g!: Generation;
  const hang = tool('hang', async () => {
    g.abort('shutdown');
    return new Promise(() => {});
  });
  const s = start([callStep('c1', 'hang', '{}'), [text('never')]], [hang]);
  g = s.generation;
  const final = await s.finished;
  expect(final.status).toBe('interrupted');
  expect(s.streamChat).toHaveBeenCalledTimes(1);
});

test('a dropped tool call is not output: the turn is an empty response', async () => {
  const t = echo();
  const r = await run([callStep('c1', 'echo', '{"q":"a"}')], [t], { over: { maxSteps: 1 } });
  expect(t.execute).not.toHaveBeenCalled();
  expect(r.final.status).toBe('error');
  expect(r.final.parts).toEqual([
    expect.objectContaining({ type: 'error', code: 'empty_response' }),
  ]);
});

test('an executed tool call alone is output', async () => {
  const r = await run([callStep('c1', 'echo', '{"q":"a"}'), [stop]], [echo()]);
  expect(r.final.status).toBe('complete');
});

test('invalid JSON on an ask tool is not asked', async () => {
  const t = tool('echo', echo().execute, { defaultPolicy: 'ask' });
  const r = await run([callStep('c1', 'echo', '{"q"'), [text('ok'), stop]], [t]);
  const statuses = r.events
    .filter((e) => e.type.startsWith('tool.'))
    .map((e) => (e as { call: ToolCallPart }).call.status);
  expect(statuses).toEqual(['running', 'error']);
  expect(t.execute).not.toHaveBeenCalled();
  expect(r.final.status).toBe('complete');
});

test('a tool that returns no text becomes an error result', async () => {
  const odd = tool('odd', async () => ({ ok: true, content: undefined }) as never);
  const fine = echo();
  const r = await run(
    [
      [...call(0, 'c1', 'odd', '{}'), ...call(1, 'c2', 'echo', '{"q":"x"}'), toolCalls],
      [text('ok')],
    ],
    [odd, fine],
  );
  expect(toolParts(r.final).map((p) => [p.status, p.result])).toEqual([
    ['error', "The tool returned something that isn't text."],
    ['ok', 'echo: x'],
  ]);
  expect(r.final.status).toBe('complete');
  expect(r.final.parts.at(-1)).toEqual({ type: 'text', text: 'ok' });
});

test('repeated call ids in one step get unique ids everywhere', async () => {
  const t = tool('echo', echo().execute, { defaultPolicy: 'ask' });
  const s = start(
    [
      [...call(0, 'dup', 'echo', '{"q":"a"}'), ...call(1, 'dup', 'echo', '{"q":"b"}'), toolCalls],
      [text('ok'), stop],
    ],
    [t],
  );
  await waitFor(
    () =>
      s.generation
        .snapshot()
        .parts.filter((p) => p.type === 'tool_call' && p.status === 'awaiting_approval').length ===
      2,
  );
  const ids = toolParts(s.generation.snapshot()).map((p) => p.id);
  expect(new Set(ids).size).toBe(2);
  expect(ids[0]).toBe('dup');
  for (const id of ids) expect(s.generation.resolveApproval(id, 'allow')).toBe(true);
  const final = await s.finished;
  expect(toolParts(final).map((p) => [p.id, p.status, p.result])).toEqual([
    [ids[0], 'ok', 'echo: a'],
    [ids[1], 'ok', 'echo: b'],
  ]);
  const tail = lastMessages(s.requests[1] as ChatRequest, 3);
  expect((tail[0] as { toolCalls: { id: string }[] }).toolCalls.map((c) => c.id)).toEqual(ids);
  expect(tail.slice(1).map((m) => (m as { toolCallId: string }).toolCallId)).toEqual(ids);
});

test('every model call writes its own usage row', async () => {
  const usage = (p: number) => ({
    type: 'usage' as const,
    usage: {
      promptTokens: p,
      completionTokens: 1,
      reasoningTokens: 0,
      cachedTokens: 0,
      costUsd: 0.001,
      webSearchRequests: 0,
    },
  });
  const r = await run(
    [
      [{ type: 'meta', generationRef: 'gen-a' }, ...callStep('c1', 'echo', '{"q":"a"}'), usage(10)],
      [{ type: 'meta', generationRef: 'gen-b' }, text('ok'), stop, usage(20)],
    ],
    [echo()],
  );
  expect(r.usageRows.map((u) => [u.kind, u.generationRef, u.usage.promptTokens])).toEqual([
    ['chat', 'gen-a', 10],
    ['chat', 'gen-b', 20],
  ]);
  expect(r.usageRows[0]?.messageId).toBe('msg_1');
  expect(r.final.usage?.promptTokens).toBe(30);
  expect(r.final.usage?.costUsd).toBeCloseTo(0.002);
});
