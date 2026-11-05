import type { ConversationSummary, MessagePublic, Source, StreamEvent } from '@neotext/shared';

/** A message with sensible defaults; `parts` and the rest can be overridden. */
export function msg(over: Partial<MessagePublic> & { id: string }): MessagePublic {
  return {
    conversationId: 'cnv_1',
    parentId: null,
    role: 'assistant',
    status: 'complete',
    parts: [],
    model: over.role === 'user' ? null : { providerId: 'prv_1', modelId: 'acme/neo-writer-2' },
    usage: null,
    finishReason: null,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

export function summary(over: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: 'cnv_1',
    title: 'Thesis outline help',
    titleSource: 'auto',
    folderId: null,
    pinned: false,
    pinPosition: null,
    archived: false,
    presetId: null,
    modelRef: { providerId: 'prv_1', modelId: 'acme/neo-writer-2' },
    activeLeafId: null,
    messageCount: 0,
    createdAt: 1,
    updatedAt: 1,
    lastActivityAt: 1,
    deletedAt: null,
    ...over,
  };
}

export const textOf = (m: MessagePublic | undefined): string =>
  (m?.parts ?? []).flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('');

export function source(n: number): Source {
  return { n, url: `https://e${n}.test/`, title: `Source ${n}`, domain: `e${n}.test`, snippet: '' };
}

type Ev<T extends StreamEvent['type']> = Extract<StreamEvent, { type: T }>;
type Body<T extends StreamEvent['type']> = Omit<Ev<T>, 'type' | 'generationId' | 'seq'>;

/** Builds stream events for one generation with increasing `seq`, starting at `from`. */
export function eventsFor(generationId: string, from = 1) {
  let seq = from;
  const make = <T extends StreamEvent['type']>(type: T, body: Body<T>, at?: number): Ev<T> => {
    const e = { type, generationId, seq: at ?? seq, ...body } as unknown as Ev<T>;
    seq = (at ?? seq) + 1;
    return e;
  };
  return {
    started: (assistantMessage: MessagePublic, userMessage: MessagePublic | null = null) =>
      make('generation.started', {
        conversationId: assistantMessage.conversationId,
        userMessage,
        assistantMessage,
        contextTrimmed: 0,
      }),
    snapshot: (message: MessagePublic, at?: number) => make('generation.snapshot', { message }, at),
    text: (text: string, at?: number) => make('text.delta', { text }, at),
    reasoning: (text: string) => make('reasoning.delta', { text }),
    reasoningDone: (durationMs: number) => make('reasoning.done', { durationMs }),
    sources: (...sources: Source[]) => make('sources.added', { sources }),
    activity: (kind: 'searching' | 'processing' | 'idle') => make('activity', { kind }),
    finished: (message: MessagePublic) => make('generation.finished', { message }),
    titled: (conversationId: string, title: string) =>
      make('conversation.updated', { conversationId, title }),
  };
}

/**
 * An SSE body from events. `fail` errors the stream after the last event; `hang` keeps it open
 * and silent, like a half-open connection.
 */
export function sseStream(events: StreamEvent[], opts: { fail?: boolean; hang?: boolean } = {}) {
  const encoder = new TextEncoder();
  const queue = [...events];
  // Pull-based: erroring a stream discards chunks not yet read, so fail only once all are read.
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const e = queue.shift();
      if (e) controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      else if (opts.hang) await new Promise(() => {});
      else if (opts.fail) {
        // Give the reader time to take what was sent, as a real connection would.
        await new Promise((r) => setTimeout(r, 30));
        controller.error(new TypeError('network connection was lost'));
      } else controller.close();
    },
  });
}
