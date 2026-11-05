import {
  ApprovalBodySchema,
  ChatRequestBodySchema,
  type StreamEventPayload,
  type ToolCallPart,
} from '@neotext/shared';
import { type Context, Hono } from 'hono';
import { getAuth, requireAuth } from '../auth/middleware';
import type { Container } from '../container';
import type { AppEnv, AuthContext } from '../http/env';
import { AppError } from '../http/errors';
import { readJson } from '../http/validate';
import type { Generation } from './generation/generation';
import { streamTurn } from './sse-response';

export const IDEMPOTENCY_KEY_MAX = 64;

function idempotencyKey(c: Context<AppEnv>): string | null {
  const key = c.req.header('Idempotency-Key');
  if (key === undefined || key === '') return null;
  if (key.length > IDEMPOTENCY_KEY_MAX) {
    throw new AppError(
      'bad_request',
      `The Idempotency-Key header can be at most ${IDEMPOTENCY_KEY_MAX} characters.`,
      400,
    );
  }
  return key;
}

/** `generation.finished` for a generation that already ended, so a late reader still gets it. */
const finishedTail = (g: Generation): StreamEventPayload[] =>
  g.status() === 'streaming' ? [] : [{ type: 'generation.finished', message: g.snapshot() }];

const notWaiting = () =>
  new AppError(
    'not_found',
    'That tool call is not waiting for an answer any more. Reload the conversation.',
    404,
  );

export function chatRoutes(container: Container): Hono<AppEnv> {
  const { chat, generations, settings, log } = container;
  const routes = new Hono<AppEnv>();
  routes.use('/chat', requireAuth);
  routes.use('/generations/*', requireAuth);

  /**
   * Called when a stream's client goes away. Without background answers, a generation stops
   * once nobody is reading it any more.
   */
  const abortUnwatched = (auth: AuthContext, gens: Generation[]) => () => {
    let keepRunning = true;
    try {
      keepRunning = settings.get(auth.userId, auth.dek).settings.chat.continueInBackground;
    } catch (err) {
      log.error({ err }, 'could not read settings after a disconnect; answers keep running');
    }
    if (keepRunning) return;
    for (const g of gens) {
      if (g.status() === 'streaming' && g.subscriberCount() === 0) g.abort('disconnect');
    }
  };

  const ownGeneration = (c: Context<AppEnv>): Generation => {
    const g = generations.get(c.req.param('id') ?? '');
    if (!g || g.userId !== getAuth(c).userId) {
      throw new AppError(
        'not_found',
        'That answer is not generating any more. Reload the conversation to see it.',
        404,
      );
    }
    return g;
  };

  routes.post('/chat', async (c) => {
    const auth = getAuth(c);
    const key = idempotencyKey(c);
    const body = await readJson(c, ChatRequestBodySchema);
    const turn = await chat.startTurn(auth, body, key);
    const first = new Map<string, StreamEventPayload[]>(
      turn.generations.map((g, i) => [
        g.id,
        [
          {
            type: 'generation.started',
            conversationId: turn.conversationId,
            userMessage: i === 0 ? turn.userMessage : null,
            assistantMessage: g.snapshot(),
            contextTrimmed: turn.contextTrimmed,
          },
          ...(turn.reused ? finishedTail(g) : []),
        ],
      ]),
    );
    const onDisconnect = abortUnwatched(auth, turn.generations);
    return streamTurn(c, turn.generations, first, { onDisconnect, log });
  });

  routes.get('/generations/active', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ items: generations.active(getAuth(c).userId) });
  });

  routes.get('/generations/:id/stream', (c) => {
    const g = ownGeneration(c);
    const payloads: StreamEventPayload[] = [
      { type: 'generation.snapshot', message: g.snapshot() },
      ...finishedTail(g),
    ];
    const onDisconnect = abortUnwatched(getAuth(c), [g]);
    return streamTurn(c, [g], new Map([[g.id, payloads]]), { onDisconnect, log });
  });

  routes.post('/generations/:id/approvals', async (c) => {
    const g = ownGeneration(c);
    const auth = getAuth(c);
    const body = await readJson(c, ApprovalBodySchema);
    const waiting = g
      .snapshot()
      .parts.findLast(
        (p): p is ToolCallPart =>
          p.type === 'tool_call' && p.id === body.callId && p.status === 'awaiting_approval',
      );
    if (!waiting) throw notWaiting();
    // Saved first: if saving fails, the call is still waiting and the client can try again.
    if (body.remember && body.decision === 'allow') {
      settings.patch(auth.userId, auth.dek, { tools: { policies: { [waiting.name]: 'auto' } } });
    }
    if (!g.resolveApproval(body.callId, body.decision)) throw notWaiting();
    return c.body(null, 204);
  });

  routes.post('/generations/:id/abort', (c) => {
    const g = ownGeneration(c);
    generations.abort(g.userId, g.id);
    return c.body(null, 204);
  });

  return routes;
}
