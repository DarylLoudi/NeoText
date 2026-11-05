import {
  ATTACHMENT_UNAVAILABLE_ID,
  type ChatRequestBody,
  type ConversationDetail,
  type ConversationSummary,
  childrenOf,
  type MessagePublic,
  type ModelRef,
  type ReasoningEffort,
  type StreamEvent,
} from '@neotext/shared';
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chatApi } from '../../../lib/api/chat';
import { qk } from '../../../lib/query';
import {
  clearGeneration,
  flushEvents,
  type GenerationsState,
  getGenerationsState,
  liveMessageFor,
  useGenerations,
} from '../../../state/generations';
import { getSettingsState } from '../../../state/settings';
import { findConversation, upsertConversation } from '../../sidebar/use-conversations';
import { visibleLeaf } from '../thread';
import {
  conversationDetailQuery,
  newIdempotencyKey,
  resumeGeneration,
  setStreamQueryClient,
  startTurn,
  stopGeneration,
} from './stream-client';
import { webChoiceFor } from './web-choice';

export { conversationDetailQuery };

export interface SendOptions {
  targets: ModelRef[];
  webSearch?: boolean;
  reasoningEffort?: ReasoningEffort | null;
  temperature?: number | null;
  maxOutputTokens?: number | null;
  presetId?: string | null;
  folderId?: string | null;
  /** Finished uploads that go with the message. */
  attachmentIds?: string[];
}

function requestOptions(o: Partial<SendOptions>): ChatRequestBody['options'] {
  return {
    webSearch: o.webSearch ?? false,
    reasoningEffort: o.reasoningEffort ?? null,
    temperature: o.temperature ?? null,
    maxOutputTokens: o.maxOutputTokens ?? null,
    presetId: o.presetId ?? null,
    folderId: o.folderId ?? null,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/**
 * Tries again for one message saved as streaming: reads the active list afresh, then follows
 * its generation. When it is not on the list, the saved copy is old, so that is read again.
 * Rejects when the list cannot be read; the query keeps that error for whoever watches it.
 */
export async function resumeMessage(
  qc: QueryClient,
  conversationId: string,
  messageId: string,
): Promise<void> {
  // A read that hangs would otherwise be shared with this one.
  await qc.cancelQueries({ queryKey: qk.active });
  const items = await qc.fetchQuery({
    queryKey: qk.active,
    queryFn: chatApi.active,
    staleTime: 0,
  });
  const generation = items.find((g) => g.assistantMessageId === messageId);
  if (!generation) {
    void qc.invalidateQueries({ queryKey: qk.conversation(conversationId) });
    return;
  }
  if (liveMessageFor(messageId)) return;
  void resumeGeneration(generation.id, conversationId, { onEvent: cacheUpdater(qc, null) });
}

/** A summary for a chat the server just created, shown until the real one loads. */
function newSummary(
  e: Extract<StreamEvent, { type: 'generation.started' }>,
  body: ChatRequestBody,
) {
  const now = e.assistantMessage.createdAt;
  const summary: ConversationSummary = {
    id: e.conversationId,
    title: null,
    titleSource: 'none',
    folderId: body.options.folderId,
    pinned: false,
    pinPosition: null,
    archived: false,
    presetId: body.options.presetId,
    modelRef: e.assistantMessage.model,
    activeLeafId: e.assistantMessage.id,
    messageCount: e.userMessage ? 2 : 1,
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    deletedAt: null,
  };
  return summary;
}

function withMessages(messages: MessagePublic[], incoming: MessagePublic[]): MessagePublic[] {
  const ids = new Set(incoming.map((m) => m.id));
  return [...messages.filter((m) => !ids.has(m.id)), ...incoming];
}

/**
 * Keeps the query cache in step with a turn's events: new messages and the active leaf on
 * `generation.started`, the final message on `generation.finished`, the title on
 * `conversation.updated`. `body` is null for a generation resumed after a reload.
 */
function cacheUpdater(qc: QueryClient, body: ChatRequestBody | null) {
  let leafSet = false;
  return (e: StreamEvent) => {
    if (e.type === 'generation.started') {
      const incoming = [e.userMessage, e.assistantMessage].filter(
        (m): m is MessagePublic => m !== null,
      );
      const setLeaf = !leafSet;
      leafSet = true;
      qc.setQueryData<ConversationDetail>(qk.conversation(e.conversationId), (d) => {
        if (!d) {
          // A chat the server just created: show it at once; the real summary loads after.
          if (body?.conversationId !== null) return d;
          return { conversation: newSummary(e, body), messages: incoming };
        }
        const conversation = setLeaf
          ? { ...d.conversation, activeLeafId: e.assistantMessage.id }
          : d.conversation;
        return { conversation, messages: withMessages(d.messages, incoming) };
      });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: qk.active });
    } else if (e.type === 'generation.finished') {
      const key = qk.conversation(e.message.conversationId);
      qc.setQueryData<ConversationDetail>(key, (d) =>
        d ? { ...d, messages: withMessages(d.messages, [e.message]) } : d,
      );
      // The server saved the final message before sending this, so a refetch is never older
      // than it, and it replaces any refetch that raced with the end of the answer.
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: qk.active });
    } else if (e.type === 'conversation.updated') {
      const known = findConversation(qc, e.conversationId);
      if (known && e.title !== null) {
        upsertConversation(qc, { ...known, title: e.title, titleSource: 'auto' });
        // A refetch started when the answer finished may have read the chat before the title
        // was saved. The server saves it before sending this event, so a fresh read is current,
        // and starting one replaces the older read that is still on its way.
        void qc.invalidateQueries({ queryKey: ['conversations'] });
        void qc.invalidateQueries({ queryKey: qk.conversation(e.conversationId) });
      }
    }
  };
}

/**
 * Ids of this chat's generations still being written, joined (a stable store selection). A
 * lost one is not: nothing more will arrive, so it never blocks the next send.
 */
function streamingIn(s: GenerationsState, conversationId: string | null): string {
  if (conversationId === null) return '';
  return Object.values(s.byId)
    .filter(
      (g) => g.conversationId === conversationId && g.message.status === 'streaming' && !g.lost,
    )
    .map((g) => g.generationId)
    .join(' ');
}

/** Whether redoing the answer to this user message searches the web (see `webChoiceFor`). */
const attachmentIdsOf = (m: MessagePublic) =>
  m.parts.flatMap((p) =>
    p.type === 'attachment' && p.attachmentId !== ATTACHMENT_UNAVAILABLE_ID ? [p.attachmentId] : [],
  );

const redoesWeb = (messages: MessagePublic[], userMessageId: string) =>
  webChoiceFor(messages, userMessageId, getSettingsState().settings.webSearch.defaultOn);

/** The answer that follows a user message in the active branch, else its newest answer. */
function modelFor(messages: MessagePublic[], userMessageId: string): ModelRef | null {
  const answers = childrenOf(messages, userMessageId).filter((m) => m.role === 'assistant');
  return answers.at(-1)?.model ?? null;
}

/**
 * Sends, regenerates, edits and stops turns in one chat. Each call resolves `true` once the
 * server accepted the turn (its first `generation.started`), `false` when ignored because a
 * turn is already starting or running, and rejects with `ApiError` if it failed before that.
 */
export function useChatStream(conversationId: string | null) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const streaming = useGenerations((s) => streamingIn(s, conversationId));
  const generating = starting || streaming !== '';
  const generatingRef = useRef(generating);
  generatingRef.current = generating;
  /** Messages refreshed once because they looked unfinished with nothing running for them. */
  const refreshed = useRef(new Set<string>());

  const detail = useQuery({
    ...conversationDetailQuery(conversationId ?? ''),
    enabled: conversationId !== null,
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => setStreamQueryClient(qc), [qc]);

  // Leaving a chat drops its finished generations; the cache already holds their final text.
  useEffect(
    () => () => {
      for (const g of Object.values(getGenerationsState().byId)) {
        if (g.conversationId === conversationId && g.message.status !== 'streaming') {
          clearGeneration(g.generationId);
        }
      }
    },
    [conversationId],
  );

  // Answers still being written when the chat loads (after a reload, or from another tab).
  useEffect(() => {
    const messages = detail.data?.messages;
    if (!messages || conversationId === null) return;
    const waiting = new Set(
      messages
        .filter((m) => m.role === 'assistant' && m.status === 'streaming' && !liveMessageFor(m.id))
        .map((m) => m.id),
    );
    if (waiting.size === 0) return;
    let cancelled = false;
    chatApi.active().then(
      (items) => {
        if (cancelled) return;
        for (const g of items) {
          if (!waiting.has(g.assistantMessageId)) continue;
          waiting.delete(g.assistantMessageId);
          if (liveMessageFor(g.assistantMessageId)) continue;
          void resumeGeneration(g.id, conversationId, { onEvent: cacheUpdater(qc, null) });
        }
        // Still "streaming" in the cache, but nothing runs for it: the cached copy is older than
        // the server's. Refresh once per message, so a row that stays odd cannot loop.
        const stale = [...waiting].filter((id) => !refreshed.current.has(id));
        if (stale.length === 0) return;
        for (const id of stale) refreshed.current.add(id);
        void qc.invalidateQueries({ queryKey: qk.conversation(conversationId) });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [detail.data, conversationId, qc]);

  const run = useCallback(
    (body: ChatRequestBody): Promise<boolean> => {
      if (busy.current || generatingRef.current) return Promise.resolve(false);
      // One key per send, made before anything is marked busy (it can never throw now, but
      // nothing below may leave `busy` stuck). A retried request is the same turn.
      const idempotencyKey = newIdempotencyKey();
      busy.current = true;
      setStarting(true);
      const release = () => {
        busy.current = false;
        if (mounted.current) setStarting(false);
      };
      return new Promise<boolean>((resolve, reject) => {
        let accepted = false;
        const update = cacheUpdater(qc, body);
        const onEvent = (e: StreamEvent) => {
          update(e);
          if (e.type !== 'generation.started' || accepted) return;
          accepted = true;
          // Show the new turn now, so "generating" never blinks off between start and frame.
          flushEvents();
          release();
          resolve(true);
          if (body.conversationId === null && mounted.current) {
            void navigate({
              to: '/c/$conversationId',
              params: { conversationId: e.conversationId },
            });
          }
        };
        startTurn(body, { idempotencyKey, onEvent }).then(
          () => {
            if (accepted) return;
            release();
            resolve(false);
          },
          (err: unknown) => {
            if (accepted) return;
            release();
            reject(err);
          },
        );
      });
    },
    [qc, navigate],
  );

  const messages = useCallback(
    () =>
      conversationId === null
        ? []
        : (qc.getQueryData<ConversationDetail>(qk.conversation(conversationId))?.messages ?? []),
    [qc, conversationId],
  );

  /** A new chat, or one whose messages are loaded: only then is it known where a send goes. */
  const ready = conversationId === null || detail.data !== undefined;

  const send = useCallback(
    (text: string, opts: SendOptions) => {
      let leaf: string | null = null;
      if (conversationId !== null) {
        const cached = qc.getQueryData<ConversationDetail>(qk.conversation(conversationId));
        // Without the messages the send would start a new root with no context: refuse it.
        if (!cached) return Promise.resolve(false);
        leaf = visibleLeaf(cached.messages, cached.conversation.activeLeafId);
      }
      return run({
        conversationId,
        parentId: leaf,
        userMessage: { text, attachmentIds: opts.attachmentIds ?? [] },
        targets: opts.targets,
        options: requestOptions(opts),
      });
    },
    [run, qc, conversationId],
  );

  const regenerate = useCallback(
    (userMessageId: string, target?: ModelRef) => {
      const model =
        target ?? modelFor(messages(), userMessageId) ?? detail.data?.conversation.modelRef;
      if (!model || conversationId === null) return Promise.resolve(false);
      return run({
        conversationId,
        parentId: userMessageId,
        userMessage: null,
        targets: [model],
        options: requestOptions({ webSearch: redoesWeb(messages(), userMessageId) }),
      });
    },
    [run, messages, conversationId, detail.data],
  );

  const editAndResend = useCallback(
    (message: MessagePublic, text: string) => {
      const model = modelFor(messages(), message.id) ?? detail.data?.conversation.modelRef;
      if (!model || conversationId === null) return Promise.resolve(false);
      return run({
        conversationId,
        parentId: message.parentId,
        // The edit keeps the message's files; the server copies them for the new version.
        userMessage: { text, attachmentIds: attachmentIdsOf(message) },
        targets: [model],
        options: requestOptions({ webSearch: redoesWeb(messages(), message.id) }),
      });
    },
    [run, messages, conversationId, detail.data],
  );

  const stop = useCallback(() => {
    for (const id of streaming.split(' ').filter(Boolean)) {
      // A 404 means it already ended; the stream reports how.
      stopGeneration(id).catch(() => undefined);
    }
  }, [streaming]);

  return useMemo(
    () => ({ send, regenerate, editAndResend, stop, generating, ready }),
    [send, regenerate, editAndResend, stop, generating, ready],
  );
}
