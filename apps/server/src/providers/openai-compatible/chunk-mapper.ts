import { errorFromChunk } from '../errors';
import type { FinishReason, ProviderEvent, ProviderUsage } from '../types';
import { createThinkSplitter } from './think-splitter';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const FINISH_REASONS: Record<string, FinishReason> = {
  stop: 'stop',
  length: 'length',
  tool_calls: 'tool_calls',
  function_call: 'tool_calls',
  content_filter: 'content_filter',
  error: 'error',
};

function mapUsage(u: Obj): ProviderUsage {
  const prompt = isObj(u.prompt_tokens_details) ? u.prompt_tokens_details : {};
  const completion = isObj(u.completion_tokens_details) ? u.completion_tokens_details : {};
  const server = isObj(u.server_tool_use_details) ? u.server_tool_use_details : {};
  return {
    promptTokens: num(u.prompt_tokens),
    completionTokens: num(u.completion_tokens),
    reasoningTokens: num(completion.reasoning_tokens),
    cachedTokens: num(prompt.cached_tokens),
    costUsd: typeof u.cost === 'number' && Number.isFinite(u.cost) ? u.cost : null,
    webSearchRequests: num(server.web_search_requests),
  };
}

/** Turns OpenAI-style chat completion chunks into normalized provider events. */
export function createChunkMapper(opts: { splitThinkTags: boolean }): {
  map(chunk: unknown): ProviderEvent[];
  flush(): ProviderEvent[];
} {
  const splitter = opts.splitThinkTags ? createThinkSplitter() : null;
  let finished = false;
  let sawProvider = false;
  let sawId = false;

  const pushSplit = (out: ProviderEvent[], s: { text: string; reasoning: string }) => {
    if (s.reasoning !== '') out.push({ type: 'reasoning', text: s.reasoning });
    if (s.text !== '') out.push({ type: 'text', text: s.text });
  };

  const mapDelta = (delta: Obj, out: ProviderEvent[]) => {
    for (const key of ['reasoning', 'reasoning_content']) {
      const r = delta[key];
      if (typeof r === 'string' && r !== '') out.push({ type: 'reasoning', text: r });
    }
    if (Array.isArray(delta.reasoning_details) && delta.reasoning_details.length > 0) {
      out.push({ type: 'reasoning_details', details: delta.reasoning_details });
    }
    const content = delta.content;
    if (typeof content === 'string' && content !== '') {
      if (splitter) pushSplit(out, splitter.push(content));
      else out.push({ type: 'text', text: content });
    }
    if (Array.isArray(delta.annotations)) {
      for (const a of delta.annotations) {
        if (!isObj(a) || a.type !== 'url_citation' || !isObj(a.url_citation)) continue;
        const c = a.url_citation;
        out.push({
          type: 'citation',
          url: str(c.url),
          title: str(c.title),
          content: str(c.content),
        });
      }
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const t of delta.tool_calls) {
        if (!isObj(t)) continue;
        const index = num(t.index);
        const fn = isObj(t.function) ? t.function : {};
        if (
          typeof t.id === 'string' &&
          t.id !== '' &&
          typeof fn.name === 'string' &&
          fn.name !== ''
        ) {
          out.push({ type: 'tool_call_start', index, id: t.id, name: fn.name });
        }
        if (typeof fn.arguments === 'string' && fn.arguments !== '') {
          out.push({ type: 'tool_call_delta', index, args: fn.arguments });
        }
      }
    }
  };

  return {
    map(chunk) {
      const out: ProviderEvent[] = [];
      if (!isObj(chunk)) return out;
      if (!sawProvider && typeof chunk.provider === 'string' && chunk.provider !== '') {
        sawProvider = true;
        out.push({ type: 'meta', upstreamProvider: chunk.provider });
      }
      if (!sawId && typeof chunk.id === 'string' && chunk.id !== '') {
        sawId = true;
        out.push({ type: 'meta', generationRef: chunk.id });
      }
      const choice =
        Array.isArray(chunk.choices) && isObj(chunk.choices[0]) ? chunk.choices[0] : null;
      if (choice && isObj(choice.delta)) mapDelta(choice.delta, out);
      if (isObj(chunk.error)) out.push({ type: 'error', error: errorFromChunk(chunk.error) });
      if (choice && !finished && typeof choice.finish_reason === 'string') {
        finished = true;
        if (splitter) pushSplit(out, splitter.flush());
        out.push({ type: 'finish', reason: FINISH_REASONS[choice.finish_reason] ?? 'unknown' });
      }
      if (isObj(chunk.usage)) out.push({ type: 'usage', usage: mapUsage(chunk.usage) });
      return out;
    },
    flush() {
      const out: ProviderEvent[] = [];
      if (splitter) pushSplit(out, splitter.flush());
      return out;
    },
  };
}
