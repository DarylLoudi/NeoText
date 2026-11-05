import type { MessagePublic, ToolCallPart } from '@neotext/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { chatApi } from '../../../lib/api/chat';
import { qk } from '../../../lib/query';
import { useGenerations } from '../../../state/generations';
import { resumeMessage } from '../streaming/use-chat-stream';

/** How long a saved call may wait to reconnect before the page says it cannot tell. */
export const CALL_RESOLVE_TIMEOUT_MS = 10_000;

export interface CallLife {
  /** The live generation on this page; null while there is none (yet). */
  generationId: string | null;
  /** Nothing runs for this call any more, so its saved `running` or waiting status is stale. */
  ended: boolean;
  /** The page cannot tell: the active list failed, or the call did not reconnect in time. */
  stuck: boolean;
  /** Reads the active list again and follows the generation if it is on it. */
  retry: () => void;
}

/**
 * Whether a call can still move on. A message saved as streaming may just not be connected yet
 * (after a reload), so it counts as ended only once the server's list of active generations
 * has been read, freshly, without it. That answer stands: a later read never brings it back,
 * only a live generation does.
 */
export function useCallLife(part: ToolCallPart, message: MessagePublic): CallLife {
  const queryClient = useQueryClient();
  const generationId = useGenerations((s) => s.byMessage[message.id]?.generationId ?? null);
  const lost = useGenerations((s) => s.byMessage[message.id]?.lost ?? false);
  const streaming = message.status === 'streaming';
  const unfinished = part.status === 'running' || part.status === 'awaiting_approval';

  const callKey = `${message.id}:${part.id}`;
  const [goneKey, setGoneKey] = useState<string | null>(null);
  const wasGone = goneKey === callKey;
  const ask = streaming && unfinished && generationId === null && !wasGone;
  const active = useQuery({
    queryKey: qk.active,
    queryFn: chatApi.active,
    enabled: ask,
    staleTime: 0,
  });
  const nowGone =
    ask &&
    active.isSuccess &&
    !active.isFetching &&
    !active.data.some((g) => g.assistantMessageId === message.id);
  if (nowGone) setGoneKey(callKey);

  // Each retry gets the full time again.
  const [attempt, setAttempt] = useState(0);
  const [expired, setExpired] = useState(-1);
  useEffect(() => {
    if (!ask) return;
    const timer = setTimeout(() => setExpired(attempt), CALL_RESOLVE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [ask, attempt]);

  const failed = active.isError && !active.isFetching;
  return {
    generationId,
    ended: !streaming || lost || ((wasGone || nowGone) && generationId === null),
    stuck: ask && !nowGone && (failed || expired === attempt),
    retry: () => {
      setAttempt((n) => n + 1);
      void resumeMessage(queryClient, message.conversationId, message.id).catch(() => undefined);
    },
  };
}
