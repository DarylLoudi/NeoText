import {
  type ChatRequestBody,
  type ConversationDetail,
  type MessagePublic,
  parseSSE,
  type StreamEvent,
  StreamEventSchema,
} from '@neotext/shared';
import { type QueryClient, queryOptions } from '@tanstack/react-query';
import { chatApi } from '../../../lib/api/chat';
import { ApiError } from '../../../lib/api/client';
import { conversationsApi } from '../../../lib/api/conversations';
import { translate } from '../../../lib/i18n';
import { qk, queryClient } from '../../../lib/query';
import {
  clearGeneration,
  flushEvents,
  getGenerationsState,
  ingestEvents,
  markLost,
  setReconnecting,
} from '../../../state/generations';

/** Waits between resume attempts; the last value repeats until `RESUME_MAX_MS` has passed. */
export const RESUME_BACKOFF_MS = [250, 500, 1000, 2000, 5000];
export const RESUME_MAX_MS = 60_000;
/** A stream silent this long is treated as dropped; the server pings every 15 s. */
export const STREAM_IDLE_MS = 45_000;

export interface StreamOptions {
  idempotencyKey?: string;
  /** Called for every event, after it is queued for the store, including resumed ones. */
  onEvent?: (e: StreamEvent) => void;
}

let client: QueryClient = queryClient;

/** The query cache refreshed when a generation is gone; the chat view binds the app's own. */
export function setStreamQueryClient(qc: QueryClient): void {
  client = qc;
}

export function conversationDetailQuery(id: string) {
  return queryOptions({
    queryKey: qk.conversation(id),
    queryFn: () => conversationsApi.detail(id),
  });
}

/**
 * A random UUID v4. `crypto.randomUUID` exists only in secure contexts, and NeoText is often
 * reached over plain HTTP on a LAN, so this falls back to `getRandomValues`, which works there.
 */
export function newIdempotencyKey(): string {
  try {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // Not a secure context: build one below.
  }
  const b = new Uint8Array(16);
  if (typeof crypto?.getRandomValues === 'function') crypto.getRandomValues(b);
  else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Aborts a connection silent for `STREAM_IDLE_MS`: a half-open socket never ends by itself. */
function idleWatchdog() {
  const controller = new AbortController();
  const arm = () => setTimeout(() => controller.abort(), STREAM_IDLE_MS);
  let timer = arm();
  return {
    signal: controller.signal,
    poke: () => {
      clearTimeout(timer);
      timer = arm();
    },
    stop: () => clearTimeout(timer),
  };
}

type Watchdog = ReturnType<typeof idleWatchdog>;

/**
 * Reads SSE events until the stream ends. Returns early on the server's stream-failure `error`
 * event or when the watchdog fires, and throws when the connection drops. The caller resumes
 * in every case except after `generation.finished`.
 */
async function readEvents(
  res: Response,
  onEvent: (e: StreamEvent) => void,
  dog: Watchdog,
): Promise<void> {
  if (!res.body) return;
  try {
    for await (const msg of parseSSE(res.body, dog.signal)) {
      dog.poke(); // pings and other comments count: the connection is alive
      if (msg.kind !== 'data') continue;
      let json: unknown;
      try {
        json = JSON.parse(msg.data);
      } catch {
        continue;
      }
      // Production trusts its own server; development checks the contract.
      if (import.meta.env.DEV) {
        const parsed = StreamEventSchema.safeParse(json);
        if (!parsed.success) {
          console.error('Unexpected stream event', parsed.error);
          continue;
        }
      }
      const e = json as StreamEvent;
      onEvent(e);
      if (e.type === 'error') return;
    }
  } finally {
    dog.stop();
  }
}

function withMessage(messages: MessagePublic[], m: MessagePublic): MessagePublic[] {
  const at = messages.findIndex((x) => x.id === m.id);
  if (at < 0) return [...messages, m];
  return messages.map((x, i) => (i === at ? m : x));
}

/**
 * Reconnecting gave up (the generation is gone, or the network stayed down). The text so far
 * stays on screen with a note and is copied into the cache; the live copy goes only once a
 * refetch of the conversation succeeds, so the server's saved version replaces it.
 */
function giveUp(generationId: string, conversationId: string | null): void {
  markLost(generationId);
  void client.invalidateQueries({ queryKey: qk.active });
  const live = getGenerationsState().byId[generationId];
  if (!live || conversationId === null) {
    clearGeneration(generationId);
    return;
  }
  const query = conversationDetailQuery(conversationId);
  client.setQueryData<ConversationDetail>(query.queryKey, (d) =>
    d ? { ...d, messages: withMessage(d.messages, live.message) } : d,
  );
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success' || event.action.manual) return;
    const [scope, id] = event.query.queryKey;
    if (scope !== query.queryKey[0] || id !== conversationId) return;
    unsubscribe();
    // A later snapshot may have revived it; then it is live again and stays.
    if (getGenerationsState().byId[generationId]?.lost) clearGeneration(generationId);
  });
  void client
    .invalidateQueries({ queryKey: query.queryKey, refetchType: 'none' })
    .then(() => client.fetchQuery({ ...query, retry: false }))
    .catch(() => undefined); // still offline: a later refetch (focus, reload) finishes the job
}

const resuming = new Set<string>();

/**
 * Reconnects to a running generation until it finishes. Each connection starts with a snapshot
 * that replaces the message. Gives up (and refreshes the conversation) on a 404, or once
 * reconnecting has failed for `RESUME_MAX_MS`.
 */
async function resumeLoop(
  generationId: string,
  conversationId: string | null,
  handle: (e: StreamEvent) => void,
  immediate: boolean,
): Promise<void> {
  if (resuming.has(generationId)) return;
  resuming.add(generationId);
  try {
    let failingSince = Date.now();
    let attempt = 0;
    setReconnecting(generationId, true);
    while (true) {
      if (!(immediate && attempt === 0)) {
        const at = Math.min(attempt, RESUME_BACKOFF_MS.length - 1);
        await sleep(RESUME_BACKOFF_MS[at] ?? 5000);
      }
      attempt += 1;
      let finished = false;
      // Covers waiting for the response too: a half-open socket may never answer.
      const dog = idleWatchdog();
      try {
        const res = await chatApi.resume(generationId, dog.signal);
        await readEvents(
          res,
          (e) => {
            if (e.type === 'generation.snapshot') {
              // Connected again: the time budget and backoff start over for the next drop.
              failingSince = Date.now();
              attempt = 1;
            }
            if (e.type === 'generation.finished') finished = true;
            handle(e);
          },
          dog,
        );
      } catch (err) {
        if (err instanceof ApiError && (err.status === 404 || err.status === 401)) {
          giveUp(generationId, conversationId);
          return;
        }
      } finally {
        dog.stop();
      }
      if (finished) return;
      if (Date.now() - failingSince >= RESUME_MAX_MS) {
        giveUp(generationId, conversationId);
        return;
      }
      setReconnecting(generationId, true);
    }
  } finally {
    resuming.delete(generationId);
  }
}

/** Follows a generation this page did not start (for example after a reload). */
export async function resumeGeneration(
  generationId: string,
  conversationId: string,
  opts: Pick<StreamOptions, 'onEvent'> = {},
): Promise<void> {
  const handle = (e: StreamEvent) => {
    ingestEvents([e]);
    opts.onEvent?.(e);
  };
  await resumeLoop(generationId, conversationId, handle, true);
  flushEvents();
}

/**
 * Starts a turn and follows every generation in it to the end. A failure before streaming
 * (rate limit, validation, network) rejects with `ApiError`. Once events flow, a dropped,
 * silent or failed connection is resumed per generation instead.
 */
export async function startTurn(body: ChatRequestBody, opts: StreamOptions = {}): Promise<void> {
  const key = opts.idempotencyKey ?? newIdempotencyKey();
  // Armed before the request: a server that never sends headers is a drop too, not a hang.
  const dog = idleWatchdog();
  let res: Response;
  try {
    res = await chatApi.start(body, key, dog.signal);
  } catch (err) {
    dog.stop();
    if (dog.signal.aborted) throw new ApiError('network', translate('chat.streamFailed'), 0);
    throw err;
  }
  const open = new Map<string, string>();
  const handle = (e: StreamEvent) => {
    if (e.type === 'generation.started') open.set(e.generationId, e.conversationId);
    if (e.type === 'generation.finished') open.delete(e.generationId);
    ingestEvents([e]);
    opts.onEvent?.(e);
  };
  let started = false;
  try {
    await readEvents(
      res,
      (e) => {
        started = true;
        handle(e);
      },
      dog,
    );
  } catch {
    // Dropped: every generation not yet finished is resumed below.
  }
  if (!started) {
    throw new ApiError('network', translate('chat.streamFailed'), 0);
  }
  await Promise.all(
    [...open].map(([id, conversationId]) => resumeLoop(id, conversationId, handle, false)),
  );
  flushEvents();
}

/** Asks the server to stop a generation; it ends with status `aborted` and keeps the text. */
export function stopGeneration(generationId: string): Promise<void> {
  return chatApi.abort(generationId);
}
