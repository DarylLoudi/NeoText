import type {
  MessagePublic,
  MessageStatus,
  ModelRef,
  StreamEvent,
  StreamEventPayload,
} from '@neotext/shared';
import type { Logger } from '../../lib/logger';

export type AbortReason = 'user' | 'shutdown' | 'disconnect';
export type ApprovalDecision = 'allow' | 'deny' | 'timeout';

export interface Generation {
  id: string;
  userId: string;
  conversationId: string;
  assistantMessageId: string;
  model: ModelRef;
  startedAt: number;
  signal: AbortSignal;
  status(): MessageStatus;
  /** Stamps `payload` with the next seq and sends it to every subscriber. */
  emit(payload: StreamEventPayload): void;
  /** Stamps `payload` with the next seq without sending it, for one reader's own events. */
  stamp(payload: StreamEventPayload): StreamEvent;
  subscribe(listener: (e: StreamEvent) => void): () => void;
  subscriberCount(): number;
  setMessage(m: MessagePublic): void;
  snapshot(): MessagePublic;
  finish(final: MessagePublic): void;
  finished: Promise<MessagePublic>;
  close(): void;
  closed: Promise<void>;
  abort(reason: AbortReason): void;
  abortReason(): AbortReason | null;
  /**
   * Waits for the user to allow or deny a tool call. Resolves `deny` after `timeoutMs`, or as
   * soon as the generation is aborted or finished; never rejects.
   */
  requestApproval(callId: string, timeoutMs: number): Promise<ApprovalDecision>;
  /** Answers a waiting call; false when no call with that id is waiting. */
  resolveApproval(callId: string, decision: ApprovalDecision): boolean;
}

export function createGeneration(init: {
  id: string;
  userId: string;
  conversationId: string;
  message: MessagePublic;
  model: ModelRef;
  startedAt: number;
  log: Logger;
}): Generation {
  const controller = new AbortController();
  const listeners = new Set<(e: StreamEvent) => void>();
  let message = init.message;
  let seq = 0;
  let reason: AbortReason | null = null;
  let done = false;
  let resolveFinished!: (m: MessagePublic) => void;
  let resolveClosed!: () => void;
  const approvals = new Map<
    string,
    { resolve: (d: ApprovalDecision) => void; timer: NodeJS.Timeout }
  >();
  const resolveApproval = (callId: string, decision: ApprovalDecision): boolean => {
    const pending = approvals.get(callId);
    if (!pending) return false;
    approvals.delete(callId);
    clearTimeout(pending.timer);
    pending.resolve(decision);
    return true;
  };
  const denyAll = () => {
    for (const callId of [...approvals.keys()]) resolveApproval(callId, 'deny');
  };
  const finished = new Promise<MessagePublic>((r) => {
    resolveFinished = r;
  });
  const closed = new Promise<void>((r) => {
    resolveClosed = r;
  });

  const stamp = (payload: StreamEventPayload): StreamEvent => {
    seq += 1;
    return { ...payload, generationId: init.id, seq } as StreamEvent;
  };

  const emit = (payload: StreamEventPayload) => {
    const event = stamp(payload);
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (err) {
        init.log.error({ err, generationId: init.id }, 'stream subscriber failed');
      }
    }
  };

  return {
    id: init.id,
    userId: init.userId,
    conversationId: init.conversationId,
    assistantMessageId: init.message.id,
    model: init.model,
    startedAt: init.startedAt,
    signal: controller.signal,
    status: () => message.status,
    emit,
    stamp,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscriberCount: () => listeners.size,
    setMessage: (m) => {
      message = m;
    },
    snapshot: () => message,
    finish: (final) => {
      if (done) return;
      done = true;
      denyAll();
      message = final;
      emit({ type: 'generation.finished', message: final });
      resolveFinished(final);
    },
    finished,
    close: () => resolveClosed(),
    closed,
    abort: (r) => {
      if (reason !== null) return;
      reason = r;
      controller.abort(r);
      denyAll();
    },
    abortReason: () => reason,
    requestApproval: (callId, timeoutMs) => {
      if (done || controller.signal.aborted) return Promise.resolve('deny');
      // A repeated id replaces the earlier wait, which ends as denied.
      resolveApproval(callId, 'deny');
      return new Promise<ApprovalDecision>((resolve) => {
        const timer = setTimeout(() => resolveApproval(callId, 'timeout'), timeoutMs);
        timer.unref?.();
        approvals.set(callId, { resolve, timer });
      });
    },
    resolveApproval,
  };
}
