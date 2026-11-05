import type { FinishReason, MessagePart, MessageStatus, Usage } from '@neotext/shared';
import type { Clock } from '../../lib/clock';
import type { Logger } from '../../lib/logger';
import type { MessagesRepo } from '../messages-repo';

export interface MessageWriter {
  schedule(parts: MessagePart[]): void;
  finish(final: {
    parts: MessagePart[];
    status: MessageStatus;
    usage: Usage | null;
    finishReason: FinishReason | null;
    errorCode: string | null;
    generationRef: string | null;
  }): void;
}

/** Persists the latest parts at most once per interval so a crash loses about a second. */
export function createMessageWriter(opts: {
  messages: MessagesRepo;
  dek: Buffer;
  messageId: string;
  clock: Clock;
  intervalMs?: number;
  log: Logger;
}): MessageWriter {
  const interval = opts.intervalMs ?? 1000;
  let pending: MessagePart[] | null = null;
  let timer: NodeJS.Timeout | null = null;
  let finished = false;

  const flush = () => {
    timer = null;
    const parts = pending;
    pending = null;
    if (parts === null) return;
    try {
      opts.messages.update(opts.messageId, { parts }, opts.clock.now(), opts.dek);
    } catch (err) {
      opts.log.error({ err, messageId: opts.messageId }, 'throttled message write failed');
    }
  };

  return {
    schedule: (parts) => {
      if (finished) return;
      pending = parts;
      if (timer === null) {
        timer = setTimeout(flush, interval);
        timer.unref();
      }
    },
    finish: (final) => {
      finished = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
      opts.messages.update(opts.messageId, final, opts.clock.now(), opts.dek);
    },
  };
}
