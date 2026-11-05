import { expect, test, vi } from 'vitest';
import { call, echo, log, stop, text, toolCalls } from '../../test-support/tool-harness';
import { MAX_TOOL_CALLS_PER_STEP, TOO_MANY_CALLS } from '../chat/generation/tool-loop';
import { createSemaphore } from '../lib/semaphore';
import { ProviderError } from '../providers/errors';
import type {
  ChatRequest,
  ProviderAdapter,
  ProviderEvent,
  ProviderUsage,
} from '../providers/types';
import { createSearchBudget } from '../search/budget';
import type { ToolContext, ToolDefinition } from '../tools/types';
import {
  runSubagent,
  SUBAGENT_MAX_STEPS,
  SUBAGENT_MAX_TOKENS,
  type SubagentInput,
  type SubagentToolCall,
} from './subagent';

const usage = (costUsd: number | null): ProviderEvent => ({
  type: 'usage',
  usage: {
    promptTokens: 1,
    completionTokens: 1,
    reasoningTokens: 0,
    cachedTokens: 0,
    costUsd,
    webSearchRequests: 0,
  },
});

const ctxWith = (signal: AbortSignal): ToolContext => ({
  userId: 'usr_1',
  timeZone: 'UTC',
  signal,
  http: {} as never,
  log,
  fetchSlots: createSemaphore(4),
});

/** A fake adapter that plays one scripted step per model call, or `step(n)` when given. */
function scripted(steps: ProviderEvent[][] | ((n: number) => ProviderEvent[])) {
  const requests: ChatRequest[] = [];
  const streamChat = vi.fn(async function* (_p: unknown, req: ChatRequest) {
    requests.push(structuredClone(req));
    const n = requests.length - 1;
    for (const e of typeof steps === 'function' ? steps(n) : (steps[n] ?? [])) yield e;
  });
  return { adapter: { streamChat } as unknown as ProviderAdapter, requests };
}

function input(adapter: ProviderAdapter, over: Partial<SubagentInput> = {}): SubagentInput {
  return {
    adapter,
    provider: {} as never,
    modelId: 'm/sub',
    system: 'Be brief.',
    task: 'Find X.',
    tools: [],
    ctx: ctxWith(new AbortController().signal),
    onUsage: vi.fn(),
    ...over,
  };
}

test('an answer without tool calls is the report', async () => {
  const { adapter, requests } = scripted([[text('Found '), text('X.'), stop]]);
  expect(await runSubagent(input(adapter))).toEqual({ report: 'Found X.', ok: true });
  expect(requests[0]?.messages).toEqual([
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: 'Find X.' },
  ]);
  expect(requests[0]?.model).toBe('m/sub');
});

test('a tool call runs the tool and the loop goes on', async () => {
  const t = echo();
  const { adapter, requests } = scripted([
    [...call(0, 'c1', 'echo', '{"q":"x"}'), toolCalls],
    [text('X is 1.'), stop],
  ]);
  const result = await runSubagent(input(adapter, { tools: [t] }));
  expect(result).toEqual({ report: 'X is 1.', ok: true });
  expect(t.execute).toHaveBeenCalledOnce();
  expect(requests[0]?.tools?.map((d) => d.name)).toEqual(['echo']);
  expect(requests[1]?.messages.slice(-2)).toEqual([
    {
      role: 'assistant',
      content: null,
      toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"q":"x"}' }],
    },
    { role: 'tool', toolCallId: 'c1', content: 'echo: x' },
  ]);
});

test('an unknown tool is answered with an error the model can read', async () => {
  const { adapter, requests } = scripted([
    [...call(0, 'c1', 'nope', '{}'), toolCalls],
    [text('Done'), stop],
  ]);
  await runSubagent(input(adapter, { tools: [echo()] }));
  expect(requests[1]?.messages.at(-1)).toEqual({
    role: 'tool',
    toolCallId: 'c1',
    content: 'Unknown tool: nope',
  });
});

test(`stops after ${SUBAGENT_MAX_STEPS} model calls; the last gets no tools`, async () => {
  const { adapter, requests } = scripted((n) => [
    text(`step ${n}`),
    ...call(0, `c${n}`, 'echo', '{"q":"x"}'),
    toolCalls,
  ]);
  const result = await runSubagent(input(adapter, { tools: [echo()] }));
  expect(requests).toHaveLength(SUBAGENT_MAX_STEPS);
  expect(requests[SUBAGENT_MAX_STEPS - 2]?.tools).toBeDefined();
  expect(requests[SUBAGENT_MAX_STEPS - 1]?.tools).toBeUndefined();
  expect(result).toEqual({ report: `step ${SUBAGENT_MAX_STEPS - 1}`, ok: true });
});

test('a stop returns the text so far with ok false', async () => {
  const controller = new AbortController();
  const streamChat = vi.fn(async function* (_p: unknown, _r: ChatRequest, signal: AbortSignal) {
    yield text('Partial');
    controller.abort();
    if (!signal.aborted) throw new Error('the stop did not reach the provider call');
    yield text(' more');
  });
  const adapter = { streamChat } as unknown as ProviderAdapter;
  const result = await runSubagent(input(adapter, { ctx: ctxWith(controller.signal) }));
  expect(result).toEqual({ report: 'Partial', ok: false });
});

test('the deadline ends a hanging sub-agent with ok false', async () => {
  const streamChat = vi.fn(async function* (_p: unknown, _r: ChatRequest, signal: AbortSignal) {
    yield text('Half');
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
  });
  const adapter = { streamChat } as unknown as ProviderAdapter;
  expect(await runSubagent(input(adapter, { timeoutMs: 20 }))).toEqual({
    report: 'Half',
    ok: false,
  });
});

test('a tool that hangs is stopped with the sub-agent', async () => {
  const controller = new AbortController();
  const hang: ToolDefinition = {
    ...echo(),
    name: 'hang',
    execute: () => {
      controller.abort();
      return new Promise(() => {});
    },
  };
  const { adapter } = scripted([[...call(0, 'c1', 'hang', '{}'), toolCalls]]);
  const result = await runSubagent(
    input(adapter, { tools: [hang], ctx: ctxWith(controller.signal) }),
  );
  expect(result.ok).toBe(false);
});

test('every usage event is forwarded', async () => {
  const onUsage = vi.fn((_u: ProviderUsage) => {});
  const { adapter } = scripted([
    [...call(0, 'c1', 'echo', '{"q":"x"}'), usage(0.01), toolCalls],
    [text('Done'), usage(0.02), stop],
  ]);
  await runSubagent(input(adapter, { tools: [echo()], onUsage }));
  expect(onUsage.mock.calls.map(([u]) => u.costUsd)).toEqual([0.01, 0.02]);
});

test('a provider error ends the sub-agent with ok false', async () => {
  const { adapter } = scripted([
    [text('Some'), { type: 'error', error: new Error('boom') as never }],
  ]);
  expect(await runSubagent(input(adapter))).toEqual({ report: 'Some', ok: false });
});

test('reasoning details go back with the tool calls, merged', async () => {
  const { adapter, requests } = scripted([
    [
      { type: 'reasoning_details', details: [{ type: 'reasoning.text', index: 0, text: 'a' }] },
      { type: 'reasoning_details', details: [{ type: 'reasoning.text', index: 0, text: 'b' }] },
      ...call(0, 'c1', 'echo', '{"q":"x"}'),
      toolCalls,
    ],
    [text('Done'), stop],
  ]);
  await runSubagent(input(adapter, { tools: [echo()] }));
  expect(requests[1]?.messages[2]).toMatchObject({
    role: 'assistant',
    reasoningDetails: [{ type: 'reasoning.text', index: 0, text: 'ab' }],
  });
});

test(`every call is capped at ${SUBAGENT_MAX_TOKENS} output tokens`, async () => {
  const { adapter, requests } = scripted([[text('ok'), stop]]);
  await runSubagent(input(adapter));
  expect(requests[0]?.maxTokens).toBe(SUBAGENT_MAX_TOKENS);
});

test('a rate limit before any output is tried once more', async () => {
  const limited: ProviderEvent = {
    type: 'error',
    error: new ProviderError('rate_limit', 'slow down', { retryable: true, retryAfterMs: 1 }),
  };
  const { adapter, requests } = scripted([[limited], [text('Second try'), stop]]);
  expect(await runSubagent(input(adapter))).toEqual({ report: 'Second try', ok: true });
  expect(requests).toHaveLength(2);
  const twice = scripted([[limited], [limited], [text('never')]]);
  expect(await runSubagent(input(twice.adapter))).toEqual({ report: '', ok: false });
  expect(twice.requests).toHaveLength(2);
});

test('cited sources are added to the report as links', async () => {
  const { adapter } = scripted([
    [
      { type: 'citation', url: 'https://a.example/x', title: 'A [page]', content: '' },
      { type: 'citation', url: 'https://b.example/y', title: 'B', content: '' },
      text('See https://b.example/y for more.'),
      stop,
    ],
  ]);
  const { report } = await runSubagent(input(adapter));
  expect(report).toBe(
    'See https://b.example/y for more.\n\nSources:\n- [A page](https://a.example/x)',
  );
});

test("provider searches are bounded by the sub-agent's share and spent from the budget", async () => {
  const budget = createSearchBudget(5);
  const searched: ProviderEvent = {
    type: 'usage',
    usage: {
      promptTokens: 1,
      completionTokens: 1,
      reasoningTokens: 0,
      cachedTokens: 0,
      costUsd: null,
      webSearchRequests: 2,
    },
  };
  const { adapter, requests } = scripted([
    [searched, ...call(0, 'c1', 'echo', '{"q":"x"}'), toolCalls],
    [searched, ...call(0, 'c2', 'echo', '{"q":"y"}'), toolCalls],
    [text('Done'), stop],
  ]);
  const serverTools = [{ type: 'openrouter:web_search', parameters: {} }] as const;
  await runSubagent(
    input(adapter, {
      tools: [echo()],
      serverTools: [...serverTools],
      maxServerToolCalls: 3,
      searchBudget: budget,
    }),
  );
  expect(requests[0]?.maxServerToolCalls).toBe(3);
  // Its share of 3 had 1 left after the first step's 2 searches.
  expect(requests[1]?.maxServerToolCalls).toBe(1);
  // Spent: the provider reported 2 more; the share is gone, so no search is offered.
  expect(requests[2]?.serverTools).toBeUndefined();
  expect(budget.remaining()).toBe(1);
});

test('tool calls are reported with their query or URL, and fetches are logged', async () => {
  const seen: SubagentToolCall[] = [];
  const info = vi.fn();
  const fetchTool = { ...echo(), name: 'fetch_url' };
  const searchTool = { ...echo(), name: 'web_search' };
  const { adapter } = scripted([
    [
      ...call(0, 'c1', 'web_search', '{"query":"best  tea\\nshops"}'),
      ...call(1, 'c2', 'fetch_url', '{"url":"https://example.com/p"}'),
      toolCalls,
    ],
    [text('Done'), stop],
  ]);
  const ctx = {
    ...ctxWith(new AbortController().signal),
    log: { error: vi.fn(), warn: vi.fn(), info } as never,
  };
  await runSubagent(
    input(adapter, { tools: [searchTool, fetchTool], ctx, onToolCall: (c) => seen.push(c) }),
  );
  expect(seen).toEqual([
    { name: 'web_search', detail: 'best tea shops' },
    { name: 'fetch_url', detail: 'https://example.com/p' },
  ]);
  expect(info).toHaveBeenCalledWith({ url: 'https://example.com/p' }, 'sub-agent fetch_url');
});

test(`a step runs at most ${MAX_TOOL_CALLS_PER_STEP} tool calls`, async () => {
  const t = echo();
  const many = Array.from({ length: MAX_TOOL_CALLS_PER_STEP + 2 }, (_, i) =>
    call(i, `c${i}`, 'echo', '{"q":"x"}'),
  ).flat();
  const { adapter, requests } = scripted([
    [...many, toolCalls],
    [text('Done'), stop],
  ]);
  await runSubagent(input(adapter, { tools: [t] }));
  expect(t.execute).toHaveBeenCalledTimes(MAX_TOOL_CALLS_PER_STEP);
  expect(requests[1]?.messages.at(-1)).toMatchObject({ content: TOO_MANY_CALLS });
});
