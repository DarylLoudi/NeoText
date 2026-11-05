import {
  CALL_ID_MAX,
  type StreamEventPayload,
  type SubagentRun,
  type ToolCallPart,
} from '@neotext/shared';
import type { Clock } from '../../lib/clock';
import type { ToolCallRequest } from '../../providers/types';
import type { ToolContext, ToolDefinition, ToolSet } from '../../tools/types';
import type { Accumulator } from './accumulator';
import type { Generation } from './generation';

export const TOOL_TIMEOUT_MS = 30_000;
export const TOOL_RESULT_MAX = 16_000;
export const TOOL_RESULT_STORED_MAX = 4_000;
export const APPROVAL_TIMEOUT_MS = 600_000;
export const TRUNCATED_SUFFIX = '\n[truncated]';
/** Tool calls one step may run; later calls in the step are answered with `TOO_MANY_CALLS`. */
export const MAX_TOOL_CALLS_PER_STEP = 16;

export const DECLINED = 'The user declined this tool call.';
export const NO_ANSWER =
  'The approval request timed out with no answer, so this tool call did not run.';
const STOPPED = 'The answer was stopped before this tool finished.';
const FAILED = 'The tool failed without a message.';
export const NOT_TEXT = "The tool returned something that isn't text.";
export const TOO_MANY_CALLS = `The limit of ${MAX_TOOL_CALLS_PER_STEP} tool calls in one step was reached, so this call did not run.`;

export type ToolMessage = { role: 'tool'; toolCallId: string; content: string };

export interface RunToolCallsInput {
  calls: ToolCallRequest[];
  tools: ToolSet;
  ctx: ToolContext;
  generation: Generation;
  acc: Accumulator;
  clock: Clock;
  emit: (payload: StreamEventPayload) => void;
}

type Outcome = { status: ToolCallPart['status']; text: string };
type SourceInput = { url: string; title: string; content: string };

const isSource = (v: unknown): v is SourceInput =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as SourceInput).url === 'string' &&
  typeof (v as SourceInput).title === 'string' &&
  typeof (v as SourceInput).content === 'string';

/** A result as the loop can trust it: text content, well-formed sources, or an error. */
function checkResult(result: unknown): Outcome & { sources?: SourceInput[] } {
  if (typeof result !== 'object' || result === null) return { status: 'error', text: NOT_TEXT };
  const r = result as Partial<{ ok: boolean; content: unknown; error: unknown; sources: unknown }>;
  if (r.ok !== true) return { status: 'error', text: errorText(r.error) };
  if (typeof r.content !== 'string') return { status: 'error', text: NOT_TEXT };
  const sources = Array.isArray(r.sources) ? r.sources.filter(isSource) : [];
  return { status: 'ok', text: r.content, ...(sources.length > 0 ? { sources } : {}) };
}

/** Room left for a `_n` suffix; a longer id is renamed from the local base `call`. */
const SUFFIX_ROOM = 8;

/**
 * Ids already in `used` (earlier in the step or the turn) get a suffix (`id_2`, `id_3`…), and ids
 * longer than `CALL_ID_MAX` get a short local one (`call_2`…), so parts, approvals and tool
 * messages each point at one call and every call can be approved. Adds the ids it hands out to
 * `used`; pass the turn's set so ids stay unique across steps. Use the returned calls everywhere.
 */
export function uniqueCallIds(
  calls: ToolCallRequest[],
  used: Set<string> = new Set(),
): ToolCallRequest[] {
  const incoming = new Set(calls.map((c) => c.id));
  return calls.map((c) => {
    let id = c.id;
    if (id.length > CALL_ID_MAX || used.has(id)) {
      const base = id.length <= CALL_ID_MAX - SUFFIX_ROOM ? id : 'call';
      let n = 2;
      while (incoming.has(`${base}_${n}`) || used.has(`${base}_${n}`)) n += 1;
      id = `${base}_${n}`;
    }
    used.add(id);
    return id === c.id ? c : { ...c, id };
  });
}

/** Cuts `text` so it plus the suffix stays at `max + suffix` (model) or `max` (stored). */
function cut(text: string, keep: number): string {
  if (text.length <= keep) return text;
  let end = keep;
  // Never split a surrogate pair.
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}${TRUNCATED_SUFFIX}`;
}
export const forModel = (text: string) => cut(text, TOOL_RESULT_MAX);
export const forStorage = (text: string) =>
  text.length <= TOOL_RESULT_STORED_MAX
    ? text
    : cut(text, TOOL_RESULT_STORED_MAX - TRUNCATED_SUFFIX.length);

function secondsText(ms: number): string {
  const s = ms / 1000;
  return `${s} second${s === 1 ? '' : 's'}`;
}

/** Arguments as a value, or the parser's complaint. Empty arguments mean `{}`. */
function parseArgs(raw: string): { ok: true; value: unknown } | { ok: false; message: string } {
  if (raw.trim() === '') return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

const errorText = (err: unknown) => {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return message.trim() === '' ? FAILED : message;
};

/**
 * Runs the tool with its time limit and the generation's signal. Resolves even when the tool
 * ignores its signal and never settles.
 */
async function execute(
  def: ToolDefinition,
  args: unknown,
  input: RunToolCallsInput,
  progress: (agents: SubagentRun[]) => void,
): Promise<Outcome & { sources?: SourceInput[] }> {
  const { generation } = input;
  const timeoutMs = def.timeoutMs ?? TOOL_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  let stop!: () => void;
  const stopped = new Promise<null>((resolve) => {
    stop = () => resolve(null);
  });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('timeout'));
    stop();
  }, timeoutMs);
  const onAbort = () => {
    controller.abort(generation.signal.reason);
    stop();
  };
  generation.signal.addEventListener('abort', onAbort, { once: true });
  if (generation.signal.aborted) onAbort();
  try {
    const result = await Promise.race([
      Promise.resolve().then(
        (): Promise<unknown> =>
          def.execute(args, { ...input.ctx, signal: controller.signal, progress }),
      ),
      stopped,
    ]);
    if (timedOut) {
      return { status: 'error', text: `The tool did not answer within ${secondsText(timeoutMs)}.` };
    }
    if (result === null || generation.signal.aborted) return { status: 'error', text: STOPPED };
    return checkResult(result);
  } catch (err) {
    if (timedOut) {
      return { status: 'error', text: `The tool did not answer within ${secondsText(timeoutMs)}.` };
    }
    if (generation.signal.aborted) return { status: 'error', text: STOPPED };
    input.ctx.log.warn({ tool: def.name, generationId: generation.id }, 'tool call threw');
    return { status: 'error', text: errorText(err) };
  } finally {
    clearTimeout(timer);
    generation.signal.removeEventListener('abort', onAbort);
  }
}

async function runOne(call: ToolCallRequest, input: RunToolCallsInput): Promise<ToolMessage> {
  try {
    return await runGuarded(call, input);
  } catch (err) {
    // Last line of defence: the call still answers, and the part does not stay pending.
    input.ctx.log.error({ err, generationId: input.generation.id }, 'tool call handling failed');
    const text = errorText(err);
    try {
      for (const p of input.acc.updateToolCall(call.id, {
        status: 'error',
        result: forStorage(text),
        finishedAt: input.clock.now(),
      })) {
        input.emit(p);
      }
    } catch {}
    return { role: 'tool', toolCallId: call.id, content: forModel(text) };
  }
}

async function runGuarded(call: ToolCallRequest, input: RunToolCallsInput): Promise<ToolMessage> {
  const { tools, acc, clock, emit, generation } = input;
  const send = (payloads: StreamEventPayload[]) => {
    for (const p of payloads) emit(p);
  };
  const def = tools.get(call.name);
  const args = parseArgs(call.arguments);
  const ask = def !== undefined && args.ok && tools.policy(call.name) === 'ask';
  send(
    acc.addToolCall({
      type: 'tool_call',
      id: call.id,
      name: call.name,
      source: def?.source ?? 'app',
      args: call.arguments,
      status: ask ? 'awaiting_approval' : 'running',
      result: null,
      startedAt: clock.now(),
      finishedAt: null,
    }),
  );

  // The tool's time starts at the answer: the wait for the user is not part of it.
  let answeredAt: number | null = null;
  // Sub-agent rows (`delegate_tasks`); updates after the call settled are dropped.
  let agents: SubagentRun[] | null = null;
  let settled = false;
  const progress = (rows: SubagentRun[]) => {
    if (settled) return;
    agents = rows.map((r) => ({ ...r }));
    send(acc.updateToolCall(call.id, { agents }));
  };
  const decide = async (): Promise<Outcome> => {
    if (!def) return { status: 'error', text: `Unknown tool: ${call.name}` };
    if (!args.ok) {
      return { status: 'error', text: `Tool arguments were not valid JSON: ${args.message}` };
    }
    if (ask) {
      const decision = await generation.requestApproval(call.id, APPROVAL_TIMEOUT_MS);
      answeredAt = clock.now();
      if (generation.signal.aborted) return { status: 'error', text: STOPPED };
      if (decision === 'deny') return { status: 'denied', text: DECLINED };
      if (decision === 'timeout') return { status: 'no_answer', text: NO_ANSWER };
      send(acc.updateToolCall(call.id, { status: 'running', startedAt: answeredAt }));
    }
    const outcome = await execute(def, args.value, input, progress);
    if (outcome.sources) send(acc.addSources(outcome.sources));
    return { status: outcome.status, text: outcome.text };
  };

  let outcome: Outcome;
  try {
    outcome = await decide();
  } catch (err) {
    outcome = { status: 'error', text: errorText(err) };
  }
  settled = true;
  const finishedAt = clock.now();
  // A stop or time-out can settle the call before its sub-agents report: they show as stopped.
  const finalAgents = (agents as SubagentRun[] | null)?.map((r) =>
    r.status === 'running' ? { ...r, status: 'stopped' as const, finishedAt } : r,
  );
  send(
    acc.updateToolCall(call.id, {
      status: outcome.status,
      result: forStorage(outcome.text),
      finishedAt,
      ...(answeredAt !== null ? { startedAt: answeredAt } : {}),
      ...(finalAgents ? { agents: finalAgents } : {}),
    }),
  );
  return { role: 'tool', toolCallId: call.id, content: forModel(outcome.text) };
}

/** A call past the step's limit: shown as an error and answered, but never run. */
function skip(call: ToolCallRequest, input: RunToolCallsInput): ToolMessage {
  const { acc, clock, emit } = input;
  const at = clock.now();
  const added = acc.addToolCall({
    type: 'tool_call',
    id: call.id,
    name: call.name,
    source: input.tools.get(call.name)?.source ?? 'app',
    args: call.arguments,
    status: 'error',
    result: TOO_MANY_CALLS,
    startedAt: at,
    finishedAt: at,
  });
  for (const p of added) emit(p);
  return { role: 'tool', toolCallId: call.id, content: TOO_MANY_CALLS };
}

/**
 * Runs one step's tool calls in parallel and returns the tool messages in call order. Call ids
 * must be unique (see `uniqueCallIds`). Only the first `MAX_TOOL_CALLS_PER_STEP` calls run.
 * Never rejects: unknown tools, bad arguments, denials, timeouts and failures become results
 * the model can read. Results are untrusted text and are only ever passed on as text.
 */
export function runToolCalls(input: RunToolCallsInput): Promise<ToolMessage[]> {
  return Promise.all(
    input.calls.map((call, i) =>
      i < MAX_TOOL_CALLS_PER_STEP ? runOne(call, input) : Promise.resolve(skip(call, input)),
    ),
  );
}
