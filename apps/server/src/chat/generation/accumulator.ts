import type { MessagePart, Source, StreamEventPayload, ToolCallPart } from '@neotext/shared';
import type { Clock } from '../../lib/clock';
import type {
  FinishReason,
  ProviderEvent,
  ProviderUsage,
  ToolCallRequest,
} from '../../providers/types';
import { mergeReasoningDetails } from './reasoning-details';
import { createSourceCollector } from './sources';

export type SourceInput = { url: string; title: string; content: string };

export interface Accumulator {
  apply(e: ProviderEvent): StreamEventPayload[];
  parts(): MessagePart[];
  /** Starts a model call: clears the step's tool calls, reasoning details, text and finish. */
  beginStep(): void;
  toolCalls(): ToolCallRequest[];
  /** This step's reasoning details, fragments merged by index and type, for replay. */
  reasoningDetails(): unknown[];
  /** Text the model wrote in this step. */
  stepText(): string;
  /** True once this step produced text, reasoning, a citation or a tool call. */
  stepHasOutput(): boolean;
  addToolCall(part: ToolCallPart): StreamEventPayload[];
  updateToolCall(id: string, patch: Partial<ToolCallPart>): StreamEventPayload[];
  addSources(list: SourceInput[]): StreamEventPayload[];
  /** Turn total. */
  usage(): ProviderUsage | null;
  /** Usage reported by this step's model call, for its own usage row. */
  stepUsage(): ProviderUsage | null;
  /** The upstream id of this step's model call, when the provider sent one. */
  stepGenerationRef(): string | null;
  finishReason(): FinishReason | null;
  meta(): { upstreamProvider: string | null; generationRef: string | null };
  firstTokenAt(): number | null;
  /** Text, reasoning, sources or a tool call that ran; a dropped tool call does not count. */
  hasOutput(): boolean;
}

type CorePart = Extract<MessagePart, { type: 'text' | 'reasoning' | 'tool_call' }>;
type ActivityKind = 'searching' | 'processing' | 'idle';

export function createAccumulator(opts: { clock: Clock; webSearch: boolean }): Accumulator {
  const { clock } = opts;
  const core: CorePart[] = [];
  const sources = createSourceCollector();
  let calls = new Map<number, ToolCallRequest>();
  let details: unknown[] = [];
  let total: ProviderUsage | null = null;
  let step: ProviderUsage | null = null;
  let finish: FinishReason | null = null;
  let upstreamProvider: string | null = null;
  let generationRef: string | null = null;
  let stepRef: string | null = null;
  let firstToken: number | null = null;
  let activity: ActivityKind = 'idle';
  let textInStep = '';
  let outputInStep = false;
  let reasoningStartedAt: number | null = null;

  const setActivity = (kind: ActivityKind, out: StreamEventPayload[]) => {
    if (kind === activity) return;
    activity = kind;
    out.push({ type: 'activity', kind });
  };

  const closeReasoning = (out: StreamEventPayload[]) => {
    if (reasoningStartedAt === null) return;
    const durationMs = clock.now() - reasoningStartedAt;
    reasoningStartedAt = null;
    const last = core.at(-1);
    if (last?.type === 'reasoning') last.durationMs = durationMs;
    out.push({ type: 'reasoning.done', durationMs });
  };

  const markToken = () => {
    if (firstToken === null) firstToken = clock.now();
  };

  const sum = (a: ProviderUsage | null, u: ProviderUsage): ProviderUsage => ({
    promptTokens: (a?.promptTokens ?? 0) + u.promptTokens,
    completionTokens: (a?.completionTokens ?? 0) + u.completionTokens,
    reasoningTokens: (a?.reasoningTokens ?? 0) + u.reasoningTokens,
    cachedTokens: (a?.cachedTokens ?? 0) + u.cachedTokens,
    costUsd: a?.costUsd == null && u.costUsd == null ? null : (a?.costUsd ?? 0) + (u.costUsd ?? 0),
    webSearchRequests: (a?.webSearchRequests ?? 0) + u.webSearchRequests,
  });
  const addUsage = (u: ProviderUsage) => {
    step = sum(step, u);
    total = sum(total, u);
    return total;
  };

  const apply = (e: ProviderEvent): StreamEventPayload[] => {
    const out: StreamEventPayload[] = [];
    switch (e.type) {
      case 'text': {
        markToken();
        closeReasoning(out);
        setActivity('idle', out);
        textInStep += e.text;
        outputInStep = true;
        const last = core.at(-1);
        if (last?.type === 'text') last.text += e.text;
        else core.push({ type: 'text', text: e.text });
        out.push({ type: 'text.delta', text: e.text });
        break;
      }
      case 'reasoning': {
        markToken();
        setActivity('idle', out);
        outputInStep = true;
        if (reasoningStartedAt === null) reasoningStartedAt = clock.now();
        const last = core.at(-1);
        if (last?.type === 'reasoning') last.text += e.text;
        else core.push({ type: 'reasoning', text: e.text, durationMs: null });
        out.push({ type: 'reasoning.delta', text: e.text });
        break;
      }
      case 'reasoning_details':
        details = details.concat(e.details);
        break;
      case 'tool_call_start': {
        closeReasoning(out);
        outputInStep = true;
        // A repeated start for the same index keeps what arrived; it only fills gaps.
        const known = calls.get(e.index);
        if (known) {
          if (known.id === '') known.id = e.id;
          if (known.name === '') known.name = e.name;
        } else calls.set(e.index, { id: e.id, name: e.name, arguments: '' });
        break;
      }
      case 'tool_call_delta': {
        const call = calls.get(e.index);
        if (call) call.arguments += e.args;
        break;
      }
      case 'citation': {
        closeReasoning(out);
        outputInStep = true;
        const added = sources.add({ url: e.url, title: e.title, content: e.content });
        if (added) out.push({ type: 'sources.added', sources: [added] });
        break;
      }
      case 'processing':
        setActivity(opts.webSearch && textInStep === '' ? 'searching' : 'processing', out);
        break;
      case 'meta':
        if (e.upstreamProvider !== undefined) upstreamProvider = e.upstreamProvider;
        if (e.generationRef !== undefined) {
          generationRef = e.generationRef;
          stepRef = e.generationRef;
        }
        break;
      case 'usage': {
        const sum = addUsage(e.usage);
        out.push({
          type: 'usage',
          usage: { ...sum, ttftMs: null, durationMs: null, upstreamProvider },
        });
        break;
      }
      case 'finish':
        finish = e.reason;
        closeReasoning(out);
        break;
      case 'error':
        closeReasoning(out);
        break;
    }
    return out;
  };

  return {
    apply,
    parts: () => {
      const parts: MessagePart[] = core.map((p) => ({ ...p }));
      const all = sources.all();
      if (all.length > 0) parts.push({ type: 'sources', sources: all as Source[] });
      return parts;
    },
    beginStep: () => {
      calls = new Map();
      details = [];
      textInStep = '';
      outputInStep = false;
      finish = null;
      step = null;
      stepRef = null;
    },
    toolCalls: () =>
      [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => ({ ...call })),
    reasoningDetails: () => mergeReasoningDetails(details),
    stepText: () => textInStep,
    stepHasOutput: () => outputInStep,
    addToolCall: (part) => {
      core.push({ ...part });
      return [{ type: 'tool.started', call: { ...part } }];
    },
    updateToolCall: (id, patch) => {
      const part = core.findLast((p): p is ToolCallPart => p.type === 'tool_call' && p.id === id);
      if (!part) return [];
      Object.assign(part, patch, { type: 'tool_call', id });
      return [{ type: 'tool.updated', call: { ...part } }];
    },
    addSources: (list) => {
      const added = list.flatMap((c) => sources.add(c) ?? []);
      return added.length > 0 ? [{ type: 'sources.added', sources: added }] : [];
    },
    usage: () => (total ? { ...total } : null),
    stepUsage: () => (step ? { ...step } : null),
    stepGenerationRef: () => stepRef,
    finishReason: () => finish,
    meta: () => ({ upstreamProvider, generationRef }),
    firstTokenAt: () => firstToken,
    hasOutput: () => core.length > 0 || sources.all().length > 0,
  };
}
