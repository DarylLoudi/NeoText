import type { ActiveGenerationsResponse } from '@neotext/shared';
import { AppError } from '../../http/errors';
import type { Clock } from '../../lib/clock';
import type { Logger } from '../../lib/logger';
import type { Generation } from './generation';

export const GENERATION_LIMITS = { perUser: 4, total: 64 } as const;
export const RETENTION_MS = 120_000;
export const IDEMPOTENCY_MS = 60_000;

export interface GenerationManager {
  start(g: Generation, run: (g: Generation) => Promise<void>): void;
  get(id: string): Generation | undefined;
  abort(userId: string, id: string): boolean;
  /** Stops every running generation of a user, as when an admin disables them. */
  abortAllForUser(userId: string): number;
  active(userId: string): ActiveGenerationsResponse['items'];
  assertCapacity(userId: string, adding: number): void;
  rememberIdempotency(userId: string, key: string, ids: string[]): void;
  lookupIdempotency(userId: string, key: string): string[] | null;
  shutdown(timeoutMs?: number): Promise<void>;
}

export function createGenerationManager(deps: { clock: Clock; log: Logger }): GenerationManager {
  const { log } = deps;
  const generations = new Map<string, Generation>();
  const retention = new Map<string, NodeJS.Timeout>();
  const idempotency = new Map<string, { ids: string[]; timer: NodeJS.Timeout }>();
  // Generations not yet closed: they may still be titling after they finished.
  const open = new Set<Generation>();
  let stopped = false;

  const running = () => [...generations.values()].filter((g) => g.status() === 'streaming');
  const idemKey = (userId: string, key: string) => `${userId}\u0000${key}`;

  const failIfUnfinished = (g: Generation, err: unknown) => {
    if (err) log.error({ err, generationId: g.id }, 'generation run failed');
    if (g.status() === 'streaming') {
      g.finish({ ...g.snapshot(), status: 'error', updatedAt: deps.clock.now() });
    }
    g.close();
  };

  return {
    start: (g, run) => {
      generations.set(g.id, g);
      open.add(g);
      void g.closed.then(() => open.delete(g));
      if (stopped) g.abort('shutdown');
      void g.finished.then(() => {
        if (stopped) return;
        const timer = setTimeout(() => {
          generations.delete(g.id);
          retention.delete(g.id);
        }, RETENTION_MS);
        timer.unref();
        retention.set(g.id, timer);
      });
      setImmediate(() => {
        Promise.resolve()
          .then(() => run(g))
          .then(
            () => failIfUnfinished(g, null),
            (err) => failIfUnfinished(g, err ?? new Error('generation failed')),
          );
      });
    },
    get: (id) => generations.get(id),
    abort: (userId, id) => {
      const g = generations.get(id);
      if (!g || g.userId !== userId || g.status() !== 'streaming') return false;
      g.abort('user');
      return true;
    },
    abortAllForUser: (userId) => {
      const mine = running().filter((g) => g.userId === userId);
      for (const g of mine) g.abort('user');
      return mine.length;
    },
    active: (userId) =>
      running()
        .filter((g) => g.userId === userId)
        .map((g) => ({
          id: g.id,
          conversationId: g.conversationId,
          assistantMessageId: g.assistantMessageId,
          model: g.model,
          startedAt: g.startedAt,
        })),
    assertCapacity: (userId, adding) => {
      const all = running();
      const mine = all.filter((g) => g.userId === userId).length;
      if (mine + adding > GENERATION_LIMITS.perUser) {
        throw new AppError(
          'rate_limited',
          `You already have ${GENERATION_LIMITS.perUser} answers generating. Wait for one to finish.`,
          429,
        );
      }
      if (all.length + adding > GENERATION_LIMITS.total) {
        throw new AppError(
          'rate_limited',
          'This server is busy generating other answers. Try again in a moment.',
          429,
        );
      }
    },
    rememberIdempotency: (userId, key, ids) => {
      if (stopped) return;
      const k = idemKey(userId, key);
      const old = idempotency.get(k);
      if (old) clearTimeout(old.timer);
      const timer = setTimeout(() => idempotency.delete(k), IDEMPOTENCY_MS);
      timer.unref();
      idempotency.set(k, { ids, timer });
    },
    lookupIdempotency: (userId, key) => idempotency.get(idemKey(userId, key))?.ids ?? null,
    shutdown: async (timeoutMs = 5000) => {
      stopped = true;
      for (const t of retention.values()) clearTimeout(t);
      retention.clear();
      for (const e of idempotency.values()) clearTimeout(e.timer);
      idempotency.clear();
      const active = [...open];
      for (const g of active) g.abort('shutdown');
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        timer.unref();
      });
      await Promise.race([Promise.allSettled(active.map((g) => g.closed)), timeout]);
      clearTimeout(timer);
    },
  };
}
