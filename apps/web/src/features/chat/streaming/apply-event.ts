import type { MessagePart, MessagePublic, StreamEvent } from '@neotext/shared';

type SourcesPart = Extract<MessagePart, { type: 'sources' }>;

/** Splits off the trailing sources part, which the server always keeps last. */
function split(parts: MessagePart[]): { body: MessagePart[]; sources: SourcesPart | null } {
  const last = parts.at(-1);
  if (last?.type === 'sources') return { body: parts.slice(0, -1), sources: last };
  return { body: [...parts], sources: null };
}

const join = (body: MessagePart[], sources: SourcesPart | null): MessagePart[] =>
  sources ? [...body, sources] : body;

/** Appends to the last text or reasoning part, or starts a new one (as the server does). */
function append(m: MessagePublic, type: 'text' | 'reasoning', text: string): MessagePublic {
  const { body, sources } = split(m.parts);
  const last = body.at(-1);
  if (last?.type === type) body[body.length - 1] = { ...last, text: last.text + text };
  else body.push(type === 'text' ? { type, text } : { type, text, durationMs: null });
  return { ...m, parts: join(body, sources) };
}

/**
 * Applies one stream event to the message being written, placing parts where the server's
 * accumulator does: text and reasoning in arrival order, tool calls among them, sources last.
 * Pure: the input is never changed; events that do not touch the message return it as is.
 */
export function applyStreamEvent(message: MessagePublic, e: StreamEvent): MessagePublic {
  switch (e.type) {
    case 'text.delta':
      return append(message, 'text', e.text);
    case 'reasoning.delta':
      return append(message, 'reasoning', e.text);
    case 'reasoning.done': {
      const { body, sources } = split(message.parts);
      const last = body.at(-1);
      if (last?.type !== 'reasoning') return message;
      body[body.length - 1] = { ...last, durationMs: e.durationMs };
      return { ...message, parts: join(body, sources) };
    }
    case 'tool.started':
    case 'tool.updated': {
      const { body, sources } = split(message.parts);
      // The latest row with this id, the same rule the server uses (`updateToolCall`).
      const at = body.findLastIndex((p) => p.type === 'tool_call' && p.id === e.call.id);
      if (at >= 0) body[at] = e.call;
      else body.push(e.call);
      return { ...message, parts: join(body, sources) };
    }
    case 'sources.added': {
      const { body, sources } = split(message.parts);
      const all = [...(sources?.sources ?? []), ...e.sources];
      return { ...message, parts: [...body, { type: 'sources', sources: all }] };
    }
    case 'usage':
      return { ...message, usage: e.usage };
    case 'generation.snapshot':
    case 'generation.finished':
      return e.message;
    default:
      return message;
  }
}
