import type { MessagePart, MessagePublic, MessageStatus, ModelRef, Usage } from '@neotext/shared';
import type { Clock } from '../../lib/clock';
import type { Logger } from '../../lib/logger';
import { ProviderError, shownProviderMessage } from '../../providers/errors';
import type {
  ChatMessage,
  ChatRequest,
  FinishReason,
  ProviderAdapter,
  ResolvedProvider,
} from '../../providers/types';
import type { SearchBudget } from '../../search/budget';
import type { SearchResult } from '../../search/types';
import { WEB_SEARCH_TOOL } from '../../tools/builtin/web-search';
import type { ToolContext, ToolSet } from '../../tools/types';
import type { UsageRepo } from '../../usage/repo';
import { type Accumulator, createAccumulator } from './accumulator';
import type { Generation } from './generation';
import { runToolCalls, uniqueCallIds } from './tool-loop';
import { preSearchMessage } from './web-search';
import type { MessageWriter } from './writer';

export interface RunSpec {
  generation: Generation;
  adapter: ProviderAdapter;
  provider: ResolvedProvider;
  request: ChatRequest;
  webSearch: boolean;
  writer: MessageWriter;
  userId: string;
  conversationId: string;
  model: ModelRef;
  afterFinish?: (final: MessagePublic) => Promise<void>;
  /** Tools offered to the model; the loop runs only with `toolContext` too. */
  tools?: ToolSet;
  /** Model calls per turn when tools are offered (default 8); the last one gets no tools. */
  maxSteps?: number;
  toolContext?: ToolContext;
  /**
   * Searches left in this turn. Each step is sent the rest as `max_tool_calls`; once none is
   * left the provider's search and the `web_search` tool are no longer offered.
   */
  searchBudget?: SearchBudget;
  /** Search for a model without tools: runs inside the generation, before the first call. */
  preContext?: { query: string; run(query: string, signal: AbortSignal): Promise<SearchResult[]> };
}

export interface RunDeps {
  clock: Clock;
  log: Logger;
  usage: UsageRepo;
  conversationsTouch: (conversationId: string, at: number) => void;
  /** Longest wait for a pre-search before the answer goes on without it. */
  preSearchTimeoutMs?: number;
}

const DEFAULT_RETRY_MS = 500;
export const DEFAULT_MAX_STEPS = 8;
const MAX_RATE_LIMIT_WAIT_MS = 5000;
export const PRE_SEARCH_TIMEOUT_MS = 10_000;
const EMPTY_MESSAGE = 'The model returned an empty response. Try again or pick another model.';
const THINKING_BUDGET_MESSAGE =
  'The model used its whole answer budget on thinking. Try again, or raise the answer length or lower the reasoning effort.';
const INTERNAL_MESSAGE = 'Something went wrong while generating the answer. Try again.';
const PART_EVENTS = new Set(['text', 'reasoning', 'citation', 'tool_call_start']);

type ErrorInfo = { code: string; message: string };

function canRetry(e: ProviderError): boolean {
  if (!e.retryable) return false;
  return e.code !== 'rate_limit' || (e.retryAfterMs ?? 0) <= MAX_RATE_LIMIT_WAIT_MS;
}

/** Resolves true after `ms`, or false as soon as the signal aborts. */
function wait(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Streams one attempt into `acc`. Returns the provider error, if the attempt ended with one. */
async function consume(
  spec: RunSpec,
  acc: Accumulator,
  request: ChatRequest,
): Promise<ProviderError | null> {
  const { generation } = spec;
  try {
    for await (const e of spec.adapter.streamChat(spec.provider, request, generation.signal)) {
      if (generation.signal.aborted) return null;
      for (const payload of acc.apply(e)) generation.emit(payload);
      if (PART_EVENTS.has(e.type)) publishParts(spec, acc);
      if (e.type === 'error') return e.error;
    }
  } catch (err) {
    if (err instanceof ProviderError) return err;
    if (generation.signal.aborted) return null;
    throw err;
  }
  return null;
}

/** Shares the current parts with readers of the generation and the throttled writer. */
function publishParts(spec: RunSpec, acc: Accumulator): void {
  const parts = acc.parts();
  spec.writer.schedule(parts);
  spec.generation.setMessage({ ...spec.generation.snapshot(), parts });
}

/** One usage row per upstream call that reported usage; a failed write is only logged. */
function recordCallUsage(spec: RunSpec, deps: RunDeps, acc: Accumulator): void {
  const usage = acc.stepUsage();
  if (!usage) return;
  try {
    deps.usage.insert({
      userId: spec.userId,
      conversationId: spec.conversationId,
      messageId: spec.generation.assistantMessageId,
      providerId: spec.model.providerId,
      modelId: spec.model.modelId,
      kind: 'chat',
      usage,
      generationRef: acc.stepGenerationRef(),
      createdAt: deps.clock.now(),
    });
  } catch (err) {
    deps.log.error({ err, generationId: spec.generation.id }, 'usage record failed');
  }
}

/** One model call, retried once while the step has produced nothing. */
async function streamStep(spec: RunSpec, deps: RunDeps, acc: Accumulator, request: ChatRequest) {
  let error: ProviderError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    acc.beginStep();
    try {
      error = await consume(spec, acc, request);
    } finally {
      recordCallUsage(spec, deps, acc);
    }
    if (!error || spec.generation.signal.aborted) break;
    if (attempt > 0 || acc.stepHasOutput() || !canRetry(error)) break;
    if (!(await wait(error.retryAfterMs ?? DEFAULT_RETRY_MS, spec.generation.signal))) break;
  }
  return error;
}

/**
 * Searches before the first model call and returns the messages with the results after the
 * system prompt. A failed or late search (10 s) is logged and skipped; the answer goes on.
 */
async function withPreContext(
  spec: RunSpec,
  deps: RunDeps,
  acc: Accumulator,
  messages: ChatMessage[],
): Promise<ChatMessage[]> {
  const pre = spec.preContext;
  if (!pre) return messages;
  const { generation } = spec;
  generation.emit({ type: 'activity', kind: 'searching' });
  // A plain timer rather than AbortSignal.timeout, so tests can shorten or fake it.
  const limit = new AbortController();
  const timer = setTimeout(() => limit.abort(), deps.preSearchTimeoutMs ?? PRE_SEARCH_TIMEOUT_MS);
  try {
    const signal = AbortSignal.any([generation.signal, limit.signal]);
    const results = await pre.run(pre.query, signal);
    if (generation.signal.aborted || results.length === 0) return messages;
    const added = acc.addSources(
      results.map((r) => ({ url: r.url, title: r.title, content: r.snippet })),
    );
    publishParts(spec, acc);
    for (const payload of added) generation.emit(payload);
    const at = messages[0]?.role === 'system' ? 1 : 0;
    return [...messages.slice(0, at), preSearchMessage(results), ...messages.slice(at)];
  } catch (err) {
    if (!generation.signal.aborted) {
      deps.log.warn(
        { err: err instanceof Error ? err.name : 'unknown', generationId: generation.id },
        'pre-search failed; answering without web results',
      );
    }
    return messages;
  } finally {
    clearTimeout(timer);
    generation.emit({ type: 'activity', kind: 'idle' });
  }
}

/**
 * The request of one step: the function tools when offered, and the provider's search with the
 * searches the turn has left. A spent budget drops both kinds of search.
 */
function stepRequest(spec: RunSpec, messages: ChatMessage[], offered: boolean): ChatRequest {
  const { tools: _tools, serverTools, maxServerToolCalls, ...base } = spec.request;
  const left = spec.searchBudget?.remaining();
  const spent = left === 0;
  const defs = offered
    ? (spec.tools?.defs ?? []).filter((d) => !(spent && d.name === WEB_SEARCH_TOOL))
    : [];
  const cap = left ?? maxServerToolCalls;
  const server =
    serverTools && serverTools.length > 0 && !spent
      ? { serverTools, ...(cap !== undefined ? { maxServerToolCalls: cap } : {}) }
      : {};
  return { ...base, messages, ...server, ...(defs.length > 0 ? { tools: defs } : {}) };
}

const sourceCount = (acc: Accumulator) =>
  acc.parts().reduce((n, p) => n + (p.type === 'sources' ? p.sources.length : 0), 0);

/**
 * Model calls until the model answers without tool calls, the step limit is reached, or the
 * turn fails or stops. Tool results go back to the model; the last permitted call gets no
 * tools, so the model has to answer.
 */
async function runSteps(spec: RunSpec, deps: RunDeps, acc: Accumulator) {
  const { generation, tools, toolContext, searchBudget } = spec;
  const looping = tools !== undefined && toolContext !== undefined && tools.defs.length > 0;
  const maxSteps = looping ? Math.max(1, spec.maxSteps ?? DEFAULT_MAX_STEPS) : 1;
  let messages = await withPreContext(spec, deps, acc, spec.request.messages);
  if (generation.signal.aborted) return null;
  // Call ids handed out in this turn, so a provider that reuses one per step gets a new one.
  const callIds = new Set<string>();
  for (let step = 0; step < maxSteps; step++) {
    const offered = looping && step < maxSteps - 1;
    const request = stepRequest(spec, messages, offered);
    const searchesBefore = acc.usage()?.webSearchRequests ?? 0;
    const sourcesBefore = sourceCount(acc);
    const error = await streamStep(spec, deps, acc, request);
    if (searchBudget && request.serverTools) {
      // The provider's count when it reports one; else new citations mean it searched once.
      const reported = (acc.usage()?.webSearchRequests ?? 0) - searchesBefore;
      searchBudget.spend(reported > 0 ? reported : sourceCount(acc) > sourcesBefore ? 1 : 0);
    }
    if (error || generation.signal.aborted) return error;
    const calls = uniqueCallIds(acc.toolCalls(), callIds);
    if (!offered || !tools || !toolContext) return null;
    if (acc.finishReason() !== 'tool_calls' || calls.length === 0) return null;
    const details = acc.reasoningDetails();
    const assistant: ChatMessage = {
      role: 'assistant',
      content: acc.stepText() || null,
      toolCalls: calls,
      ...(details.length > 0 ? { reasoningDetails: details } : {}),
    };
    const results = await runToolCalls({
      calls,
      tools,
      ctx: toolContext,
      generation,
      acc,
      clock: deps.clock,
      emit: (payload) => {
        publishParts(spec, acc);
        generation.emit(payload);
      },
    });
    if (generation.signal.aborted) return null;
    messages = [...messages, assistant, ...results];
  }
  return null;
}

function outcome(
  spec: RunSpec,
  acc: Accumulator,
  error: ErrorInfo | null,
): { status: MessageStatus; error: ErrorInfo | null; finishReason: FinishReason | null } {
  const { signal } = spec.generation;
  if (signal.aborted) {
    const status = spec.generation.abortReason() === 'shutdown' ? 'interrupted' : 'aborted';
    return { status, error: null, finishReason: acc.finishReason() };
  }
  if (error) return { status: 'error', error, finishReason: 'error' };
  if (!acc.hasOutput()) {
    // Nothing to show, but the model thought (hidden reasoning) or ran out of output tokens.
    const thought = acc.finishReason() === 'length' || (acc.usage()?.reasoningTokens ?? 0) > 0;
    const error = thought
      ? { code: 'thinking_budget', message: THINKING_BUDGET_MESSAGE }
      : { code: 'empty_response', message: EMPTY_MESSAGE };
    return { status: 'error', error, finishReason: 'error' };
  }
  return { status: 'complete', error: null, finishReason: acc.finishReason() ?? 'unknown' };
}

export async function runGeneration(spec: RunSpec, deps: RunDeps): Promise<void> {
  const { generation, writer } = spec;
  const { clock, log } = deps;
  const acc = createAccumulator({
    clock,
    webSearch: spec.webSearch,
    lead: generation.snapshot().parts.filter((p) => p.type === 'agent'),
  });
  let providerError: ErrorInfo | null = null;
  try {
    const err = await runSteps(spec, deps, acc);
    if (err) {
      const message = shownProviderMessage(spec.provider, err, log, {
        generationId: generation.id,
      });
      providerError = { code: err.code, message };
    }
  } catch (err) {
    log.error({ err, generationId: generation.id }, 'generation failed unexpectedly');
    providerError = { code: 'internal', message: INTERNAL_MESSAGE };
  }

  const result = outcome(spec, acc, providerError);
  const parts: MessagePart[] = acc.parts();
  if (result.error) parts.push({ type: 'error', ...result.error });
  const now = clock.now();
  const reported = acc.usage();
  const first = acc.firstTokenAt();
  const usage: Usage = {
    promptTokens: reported?.promptTokens ?? 0,
    completionTokens: reported?.completionTokens ?? 0,
    reasoningTokens: reported?.reasoningTokens ?? 0,
    cachedTokens: reported?.cachedTokens ?? 0,
    costUsd: reported?.costUsd ?? null,
    webSearchRequests: reported?.webSearchRequests ?? 0,
    ttftMs: first === null ? null : first - generation.startedAt,
    durationMs: now - generation.startedAt,
    upstreamProvider: acc.meta().upstreamProvider,
    contextTokens: acc.contextTokens(),
  };
  const generationRef = acc.meta().generationRef;
  const final: MessagePublic = {
    ...generation.snapshot(),
    status: result.status,
    parts,
    usage,
    finishReason: result.finishReason,
    updatedAt: now,
  };

  const guarded = (what: string, fn: () => void) => {
    try {
      fn();
    } catch (err) {
      log.error({ err, generationId: generation.id }, `${what} failed`);
    }
  };
  guarded('message write', () =>
    writer.finish({
      parts,
      status: result.status,
      usage,
      finishReason: result.finishReason,
      errorCode: result.error?.code ?? null,
      generationRef,
    }),
  );
  guarded('conversation touch', () => deps.conversationsTouch(spec.conversationId, now));
  guarded('finish', () => generation.finish(final));
  // Timings only: never the prompt, the answer or the model's name.
  log.info(
    { generationId: generation.id, ttftMs: usage.ttftMs, durationMs: usage.durationMs },
    'generation finished',
  );
  try {
    await spec.afterFinish?.(final);
  } catch (err) {
    log.error({ err, generationId: generation.id }, 'afterFinish failed');
  }
  generation.close();
}
