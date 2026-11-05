import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import type { Clock } from '../lib/clock';
import { AppError } from './errors';

export interface RateLimiter {
  hit(key: string): { allowed: boolean; retryAfterMs: number };
  reset(key: string): void;
}

/** Sliding window: each key remembers the times of its hits inside the window. */
export function createRateLimiter(opts: {
  windowMs: number;
  max: number;
  clock: Clock;
}): RateLimiter {
  const { windowMs, max, clock } = opts;
  const hits = new Map<string, number[]>();
  let lastSweep = clock.now();

  const prune = (key: string, times: number[], now: number): number[] => {
    const live = times.filter((at) => at > now - windowMs);
    if (live.length === 0) hits.delete(key);
    else if (live.length !== times.length) hits.set(key, live);
    return live;
  };

  return {
    hit(key) {
      const now = clock.now();
      if (now - lastSweep >= windowMs) {
        lastSweep = now;
        for (const [k, times] of hits) prune(k, times, now);
      }
      const live = prune(key, hits.get(key) ?? [], now);
      const oldest = live[0];
      if (live.length >= max && oldest !== undefined) {
        return { allowed: false, retryAfterMs: oldest + windowMs - now };
      }
      live.push(now);
      hits.set(key, live);
      return { allowed: true, retryAfterMs: 0 };
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

export function rateLimited(retryAfterMs: number): AppError {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return new AppError('rate_limited', `Too many attempts. Try again in ${seconds} seconds.`, 429);
}

/** Counts one hit on `key`; on refusal sets `Retry-After` and throws the 429. */
export function enforceLimit(c: Context, limiter: RateLimiter, key: string): void {
  const result = limiter.hit(key);
  if (result.allowed) return;
  c.header('Retry-After', String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
  throw rateLimited(result.retryAfterMs);
}

export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const first = c.req.header('X-Forwarded-For')?.split(',')[0]?.trim();
    if (first) return first;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
