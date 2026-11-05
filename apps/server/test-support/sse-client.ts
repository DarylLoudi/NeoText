import { parseSSE, type StreamEvent } from '@neotext/shared';

/**
 * Reads the stream events of an SSE response. Stops at the end of the stream, or right after
 * the first event matching `until`, in which case the body is cancelled (a client disconnect).
 */
export async function readEvents(
  res: Response,
  opts: { until?: (e: StreamEvent) => boolean } = {},
): Promise<StreamEvent[]> {
  if (!res.body) throw new Error('readEvents: the response has no body');
  const events: StreamEvent[] = [];
  let stopped = false;
  for await (const msg of parseSSE(res.body)) {
    if (msg.kind !== 'data') continue;
    const event = JSON.parse(msg.data) as StreamEvent;
    events.push(event);
    if (opts.until?.(event)) {
      stopped = true;
      break;
    }
  }
  if (stopped) await res.body.cancel();
  return events;
}
