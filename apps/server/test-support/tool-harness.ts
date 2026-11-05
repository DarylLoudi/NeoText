import type { MessagePublic, StreamEvent, ToolCallPart } from '@neotext/shared';
import { vi } from 'vitest';
import { createGeneration, type Generation } from '../src/chat/generation/generation';
import { type RunSpec, runGeneration } from '../src/chat/generation/runner';
import { createFakeClock } from '../src/lib/clock';
import { createSemaphore } from '../src/lib/semaphore';
import type { ChatRequest, ProviderAdapter, ProviderEvent } from '../src/providers/types';
import { assembleToolSet } from '../src/tools/registry';
import type { ToolContext, ToolDefinition, ToolPolicy, ToolResult } from '../src/tools/types';
import type { UsageEventInsert } from '../src/usage/repo';

/** Scripted runs of `runGeneration` with inline tools, for the tool loop tests. */
export const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as never;
export const model = { providerId: 'prv_1', modelId: 'm/1' };
export const SUFFIX = '\n[truncated]';
export const text = (t: string): ProviderEvent => ({ type: 'text', text: t });
export const stop: ProviderEvent = { type: 'finish', reason: 'stop' };
export const toolCalls: ProviderEvent = { type: 'finish', reason: 'tool_calls' };
export const call = (index: number, id: string, name: string, args: string): ProviderEvent[] => [
  { type: 'tool_call_start', index, id, name },
  { type: 'tool_call_delta', index, args },
];
export const callStep = (id: string, name: string, args: string) => [
  ...call(0, id, name, args),
  toolCalls,
];

export function tool(
  name: string,
  execute: (args: unknown, ctx: ToolContext) => Promise<ToolResult>,
  over: Partial<ToolDefinition> = {},
): ToolDefinition {
  return {
    name,
    description: `The ${name} tool.`,
    parameters: { type: 'object' },
    source: 'app',
    defaultPolicy: 'auto',
    execute: vi.fn(execute),
    ...over,
  };
}
export const echo = () =>
  tool('echo', async (args) => ({ ok: true, content: `echo: ${(args as { q: string }).q}` }));

function message(): MessagePublic {
  return {
    id: 'msg_1',
    conversationId: 'cnv_1',
    parentId: null,
    role: 'assistant',
    status: 'streaming',
    parts: [],
    model,
    usage: null,
    finishReason: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

export const newGeneration = () =>
  createGeneration({
    id: 'gen_1',
    userId: 'usr_1',
    conversationId: 'cnv_1',
    message: message(),
    model,
    startedAt: 1,
    log,
  });

export const contextFor = (g: Generation): ToolContext => ({
  userId: 'usr_1',
  timeZone: 'UTC',
  signal: g.signal,
  http: {} as never,
  log,
  fetchSlots: createSemaphore(4),
});

export function start(
  steps: ProviderEvent[][],
  tools: ToolDefinition[],
  opts: { policies?: Record<string, ToolPolicy>; over?: Partial<RunSpec> } = {},
) {
  const generation = newGeneration();
  const events: StreamEvent[] = [];
  generation.subscribe((e) => events.push(e));
  const requests: ChatRequest[] = [];
  const streamChat = vi.fn(async function* (_p: unknown, req: ChatRequest) {
    requests.push(structuredClone(req));
    for (const e of steps[requests.length - 1] ?? []) yield e;
  });
  const usageRows: UsageEventInsert[] = [];
  const done = runGeneration(
    {
      generation,
      adapter: { streamChat } as unknown as ProviderAdapter,
      provider: {} as never,
      request: { model: 'm/1', messages: [{ role: 'user', content: 'hi' }] },
      webSearch: false,
      writer: { schedule: vi.fn(), finish: vi.fn() },
      userId: 'usr_1',
      conversationId: 'cnv_1',
      model,
      tools: assembleToolSet(tools, opts.policies ?? {}),
      maxSteps: 8,
      toolContext: contextFor(generation),
      ...opts.over,
    },
    {
      clock: createFakeClock(),
      log,
      usage: { insert: (row: UsageEventInsert) => usageRows.push(row) },
      conversationsTouch: vi.fn(),
    },
  );
  const finished = done.then(() => generation.finished);
  return { generation, events, requests, streamChat, finished, usageRows };
}

export const run = async (...args: Parameters<typeof start>) => {
  const s = start(...args);
  return { ...s, final: await s.finished };
};

export const toolParts = (m: MessagePublic) =>
  m.parts.filter((p): p is ToolCallPart => p.type === 'tool_call');
export const lastMessages = (r: ChatRequest, n: number) => r.messages.slice(-n);
export const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  if (!check()) throw new Error('waitFor timed out');
};
export const awaiting = (g: Generation) =>
  g.snapshot().parts.some((p) => p.type === 'tool_call' && p.status === 'awaiting_approval');
