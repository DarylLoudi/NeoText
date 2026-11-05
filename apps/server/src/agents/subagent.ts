import { mergeReasoningDetails } from '../chat/generation/reasoning-details';
import {
  forModel,
  MAX_TOOL_CALLS_PER_STEP,
  TOO_MANY_CALLS,
  TOOL_TIMEOUT_MS,
  uniqueCallIds,
} from '../chat/generation/tool-loop';
import { ProviderError } from '../providers/errors';
import type {
  ChatMessage,
  ChatRequest,
  ProviderAdapter,
  ProviderUsage,
  ResolvedProvider,
  ServerToolSpec,
  ToolCallRequest,
} from '../providers/types';
import type { SearchBudget } from '../search/budget';
import type { ToolContext, ToolDefinition } from '../tools/types';

export const SUBAGENT_MAX_STEPS = 6;
export const SUBAGENT_TIMEOUT_MS = 120_000;
/** Output cap of each sub-agent call: reports are short, and up to six run at once. */
export const SUBAGENT_MAX_TOKENS = 2_000;
const RETRY_MS = 500;
const MAX_RETRY_WAIT_MS = 5_000;
const DETAIL_MAX = 200;
const NAME_MAX = 64;
const MAX_SOURCES = 10;

/** One tool call a sub-agent made: the tool and a short detail (the query or the URL). */
export interface SubagentToolCall {
  name: string;
  detail: string;
}

export interface SubagentInput {
  adapter: ProviderAdapter;
  provider: ResolvedProvider;
  modelId: string;
  system: string;
  task: string;
  tools: ToolDefinition[];
  ctx: ToolContext;
  onUsage: (usage: ProviderUsage) => void;
  /** The provider's own search (OpenRouter), sent on every step but the last. */
  serverTools?: ServerToolSpec[];
  /** This sub-agent's share of the delegation's provider searches, over all its steps. */
  maxServerToolCalls?: number;
  /** The delegation's searches, shared by its sub-agents; provider searches are spent from it. */
  searchBudget?: SearchBudget;
  /** Called as each tool call starts, for the sub-agent's row. */
  onToolCall?: (call: SubagentToolCall) => void;
  endUserId?: string;
  /** Replaced in tests; `SUBAGENT_TIMEOUT_MS` otherwise. */
  timeoutMs?: number;
}

const STOPPED = 'The sub-agent was stopped before this tool finished.';

/** One tool call with its time limit; resolves with text even when the tool hangs or throws. */
async function runTool(
  def: ToolDefinition | undefined,
  call: ToolCallRequest,
  ctx: ToolContext,
  signal: AbortSignal,
): Promise<string> {
  if (!def) return `Unknown tool: ${call.name}`;
  let args: unknown = {};
  try {
    if (call.arguments.trim() !== '') args = JSON.parse(call.arguments);
  } catch (err) {
    return `Tool arguments were not valid JSON: ${err instanceof Error ? err.message : ''}`;
  }
  const controller = new AbortController();
  let stop!: () => void;
  const stopped = new Promise<null>((resolve) => {
    stop = () => resolve(null);
  });
  const onAbort = () => {
    controller.abort(signal.reason);
    stop();
  };
  const timer = setTimeout(() => {
    controller.abort(new Error('timeout'));
    stop();
  }, def.timeoutMs ?? TOOL_TIMEOUT_MS);
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) onAbort();
  try {
    const { progress: _progress, ...base } = ctx;
    const result = await Promise.race([
      Promise.resolve().then(() => def.execute(args, { ...base, signal: controller.signal })),
      stopped,
    ]);
    if (result === null) return signal.aborted ? STOPPED : 'The tool did not answer in time.';
    if (!result.ok) return result.error || 'The tool failed without a message.';
    return typeof result.content === 'string' ? result.content : 'The tool returned no text.';
  } catch (err) {
    if (signal.aborted) return STOPPED;
    return err instanceof Error && err.message !== '' ? err.message : 'The tool failed.';
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

/** The query of a search or the URL of a fetch, on one short line; empty for other tools. */
function detailOf(call: ToolCallRequest): string {
  let args: unknown;
  try {
    args = JSON.parse(call.arguments);
  } catch {
    return '';
  }
  if (typeof args !== 'object' || args === null) return '';
  const value = args as { query?: unknown; url?: unknown };
  const raw = call.name === 'fetch_url' ? value.url : value.query;
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, DETAIL_MAX) : '';
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

/** A rate limit worth one more try: the provider asks for a short wait at most. */
const rateLimited = (e: unknown): e is ProviderError =>
  e instanceof ProviderError &&
  e.code === 'rate_limit' &&
  (e.retryAfterMs ?? 0) <= MAX_RETRY_WAIT_MS;

interface StepResult {
  text: string;
  calls: ToolCallRequest[];
  details: unknown[];
  /** Searches the provider reported for this call. */
  searches: number;
  citations: { url: string; title: string }[];
  error: unknown;
}

/** One model call; a provider error is returned, not thrown. */
async function streamStep(
  input: SubagentInput,
  request: ChatRequest,
  signal: AbortSignal,
): Promise<StepResult> {
  const out: StepResult = {
    text: '',
    calls: [],
    details: [],
    searches: 0,
    citations: [],
    error: null,
  };
  const calls = new Map<number, ToolCallRequest>();
  try {
    for await (const e of input.adapter.streamChat(input.provider, request, signal)) {
      if (signal.aborted) break;
      if (e.type === 'text') out.text += e.text;
      else if (e.type === 'reasoning_details') out.details.push(...e.details);
      else if (e.type === 'tool_call_start') {
        calls.set(e.index, { id: e.id, name: e.name, arguments: '' });
      } else if (e.type === 'tool_call_delta') {
        const c = calls.get(e.index);
        if (c) c.arguments += e.args;
      } else if (e.type === 'citation') out.citations.push({ url: e.url, title: e.title });
      else if (e.type === 'usage') {
        out.searches += e.usage.webSearchRequests;
        input.onUsage(e.usage);
      } else if (e.type === 'error') {
        out.error = e.error;
        break;
      }
    }
  } catch (err) {
    if (!(err instanceof ProviderError)) throw err;
    out.error = err;
  }
  out.calls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, c]) => c);
  return out;
}

/** The step, tried once more after a short rate limit when it produced nothing. */
async function streamWithRetry(
  input: SubagentInput,
  request: ChatRequest,
  signal: AbortSignal,
): Promise<StepResult> {
  const first = await streamStep(input, request, signal);
  const empty = first.text === '' && first.calls.length === 0 && first.citations.length === 0;
  if (signal.aborted || !empty || !rateLimited(first.error)) return first;
  if (!(await wait(first.error.retryAfterMs ?? RETRY_MS, signal))) return first;
  return streamStep(input, request, signal);
}

/** The report plus the sources the provider cited as links, those the text does not have. */
function withSources(report: string, cited: Map<string, string>): string {
  const missing = [...cited].filter(([url]) => !report.includes(url)).slice(0, MAX_SOURCES);
  if (missing.length === 0) return report;
  const lines = missing.map(([url, title]) => {
    const label = title.replace(/[[\]\s]+/g, ' ').trim() || url;
    return `- [${label}](${url})`;
  });
  return `${report.trimEnd()}\n\nSources:\n${lines.join('\n')}`;
}

/**
 * Runs one sub-agent: model calls over `adapter.streamChat` until it answers without tool calls
 * or `SUBAGENT_MAX_STEPS` calls are made (the last is sent no tools). A stop, the deadline or a
 * provider error returns the text so far with `ok: false`. Never rejects.
 */
export async function runSubagent(input: SubagentInput): Promise<{ report: string; ok: boolean }> {
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(new Error('timeout')),
    input.timeoutMs ?? SUBAGENT_TIMEOUT_MS,
  );
  const signal = AbortSignal.any([input.ctx.signal, deadline.signal]);
  const byName = new Map(input.tools.map((t) => [t.name, t]));
  const defs = input.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
  let messages: ChatMessage[] = [
    { role: 'system', content: input.system },
    { role: 'user', content: input.task },
  ];
  let report = '';
  const cited = new Map<string, string>();
  const done = (ok: boolean) => ({ report: report === '' ? '' : withSources(report, cited), ok });
  // This sub-agent's share of the provider's searches; the shared budget bounds it as well.
  let searchesLeft = input.maxServerToolCalls ?? Number.POSITIVE_INFINITY;
  // Call ids handed out so far, so a provider that reuses one per step gets a new one.
  const callIds = new Set<string>();
  try {
    for (let step = 0; step < SUBAGENT_MAX_STEPS; step++) {
      const last = step === SUBAGENT_MAX_STEPS - 1;
      const cap = Math.min(searchesLeft, input.searchBudget?.remaining() ?? searchesLeft);
      const server =
        !last && input.serverTools && input.serverTools.length > 0 && cap > 0
          ? {
              serverTools: input.serverTools,
              ...(Number.isFinite(cap) ? { maxServerToolCalls: cap } : {}),
            }
          : {};
      const request: ChatRequest = {
        model: input.modelId,
        messages,
        maxTokens: SUBAGENT_MAX_TOKENS,
        ...(!last && defs.length > 0 ? { tools: defs } : {}),
        ...server,
        ...(input.endUserId ? { endUserId: input.endUserId } : {}),
      };
      const result = await streamWithRetry(input, request, signal);
      if (request.serverTools) {
        // The provider's count when it reports one; else new citations mean it searched once.
        const spent = result.searches > 0 ? result.searches : result.citations.length > 0 ? 1 : 0;
        searchesLeft -= spent;
        input.searchBudget?.spend(spent);
      }
      for (const c of result.citations) if (!cited.has(c.url)) cited.set(c.url, c.title);
      if (result.text.trim() !== '') report = result.text;
      if (signal.aborted || result.error) return done(false);
      const list = uniqueCallIds(result.calls, callIds);
      if (last || list.length === 0) return done(true);
      const results = await Promise.all(
        list.map((c, i) => {
          if (i >= MAX_TOOL_CALLS_PER_STEP) return Promise.resolve(TOO_MANY_CALLS);
          const detail = detailOf(c);
          input.onToolCall?.({ name: c.name.slice(0, NAME_MAX), detail });
          // Where a sub-agent goes, never what it read.
          if (c.name === 'fetch_url') input.ctx.log.info({ url: detail }, 'sub-agent fetch_url');
          return runTool(byName.get(c.name), c, input.ctx, signal);
        }),
      );
      if (signal.aborted) return done(false);
      const details = mergeReasoningDetails(result.details);
      messages = [
        ...messages,
        {
          role: 'assistant',
          content: result.text || null,
          toolCalls: list,
          ...(details.length > 0 ? { reasoningDetails: details } : {}),
        },
        ...list.map(
          (c, i): ChatMessage => ({
            role: 'tool',
            toolCallId: c.id,
            content: forModel(results[i] ?? ''),
          }),
        ),
      ];
    }
    return done(true);
  } catch (err) {
    if (!signal.aborted) {
      input.ctx.log.warn({ err: err instanceof Error ? err.name : 'unknown' }, 'sub-agent failed');
    }
    return done(false);
  } finally {
    clearTimeout(timer);
  }
}
