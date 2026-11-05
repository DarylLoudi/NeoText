import { formatSSEData, type StreamEvent, type StreamEventPayload } from '@neotext/shared';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AppEnv } from '../http/env';
import type { Logger } from '../lib/logger';
import type { Generation } from './generation/generation';

export const PING_INTERVAL_MS = 15_000;
const STREAM_FAILED = 'The answer stream failed. Reload the conversation to see the saved answer.';

/**
 * Streams the events of `gens` over one SSE response: first the given payloads of each
 * generation (stamped with the generation's next `seq` but sent only to this response), then
 * live events. Ends when every generation is closed; a client abort unsubscribes, then calls
 * `onDisconnect`, so a generation's `subscriberCount()` there no longer counts this response.
 */
export function streamTurn(
  c: Context<AppEnv>,
  gens: Generation[],
  first: Map<string, StreamEventPayload[]>,
  opts: { onDisconnect: () => void; log?: Logger },
): Response {
  const res = streamSSE(c, async (stream) => {
    const unsubscribers: (() => void)[] = [];
    let ping: NodeJS.Timeout | undefined;
    let ended = false;
    let resolveGone!: () => void;
    const gone = new Promise<void>((r) => {
      resolveGone = r;
    });
    const cleanup = () => {
      ended = true;
      clearInterval(ping);
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
    };
    stream.onAbort(() => {
      if (ended) return;
      cleanup();
      resolveGone();
      opts.onDisconnect();
    });
    // Writes are queued in order by the stream writer; nothing here waits on the client.
    const send = (e: StreamEvent) => {
      void stream.write(formatSSEData(e));
    };

    try {
      // Subscribing and stamping in one synchronous block: no live event can slip in between,
      // so this reader sees every event once, in seq order.
      for (const g of gens) {
        unsubscribers.push(g.subscribe(send));
        for (const payload of first.get(g.id) ?? []) send(g.stamp(payload));
      }
      ping = setInterval(() => {
        void stream.write(': ping\n\n');
      }, PING_INTERVAL_MS);
      await Promise.race([Promise.all(gens.map((g) => g.closed)), gone]);
    } catch (err) {
      opts.log?.error({ err }, 'answer stream failed');
      if (!ended) {
        const generationId = gens[0]?.id ?? '';
        send({ type: 'error', generationId, seq: 0, code: 'internal', message: STREAM_FAILED });
      }
    } finally {
      cleanup();
    }
  });
  res.headers.set('Cache-Control', 'no-cache, no-transform');
  res.headers.set('X-Accel-Buffering', 'no');
  return res;
}
