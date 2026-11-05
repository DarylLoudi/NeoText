import type { Quota, QuotaStatus } from '@neotext/shared';
import { eq } from 'drizzle-orm';
import type { DbHandle } from '../db/client';
import { quotas } from '../db/schema';
import { AppError } from '../http/errors';
import type { InstanceMetaRepo } from '../instance/meta';
import type { Clock } from '../lib/clock';
import { limitReached, usd } from '../usage/budget';

/** How long a user's spend is trusted before the table is summed again. */
const CACHE_MS = 30_000;

export interface QuotaService {
  /** The member's own limit, else the instance default, else no limit. */
  effective(userId: string): Quota;
  /** The member's own limit alone; null when they follow the default. */
  own(userId: string): Quota | null;
  status(userId: string): QuotaStatus;
  /** Throws a 402 `quota_exceeded` once a limit is reached. Never stops a running generation. */
  assertWithin(userId: string): void;
  /** Adds a known cost on a shared provider to the cached figures. */
  recordSpend(userId: string, usd: number): void;
  /** null returns the member to the instance default. */
  setForUser(userId: string, q: Quota | null): void;
}

export interface QuotaServiceDeps {
  db: DbHandle;
  instance: InstanceMetaRepo;
  clock: Clock;
}

interface Spent {
  /** The UTC `YYYY-MM-DD` the figures belong to. */
  day: string;
  loadedAt: number;
  daily: number;
  monthly: number;
}

const UNLIMITED: Quota = { dailyUsd: null, monthlyUsd: null };

export function createQuotaService(deps: QuotaServiceDeps): QuotaService {
  const { db, instance, clock } = deps;
  const cache = new Map<string, Spent>();
  /**
   * Spend comes from `usage_events.shared`, written with each row, so a shared provider that
   * was deleted since still counts. Unknown costs (NULL) add nothing, as in the Plan 05 budget.
   */
  const sum = db.raw.prepare(
    'SELECT COALESCE(SUM(cost_usd), 0) AS total FROM usage_events WHERE user_id = ? AND shared = 1 AND created_at >= ? AND created_at < ?',
  );

  function spent(userId: string): Spent {
    const now = clock.now();
    const d = new Date(now);
    const day = d.toISOString().slice(0, 10);
    const hit = cache.get(userId);
    if (hit && hit.day === day && now - hit.loadedAt < CACHE_MS && now >= hit.loadedAt) return hit;
    const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const monthEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    const total = (from: number, to: number) =>
      (sum.get(userId, from, to) as { total: number }).total;
    const fresh = {
      day,
      loadedAt: now,
      daily: total(dayStart, dayStart + 86_400_000),
      monthly: total(monthStart, monthEnd),
    };
    cache.set(userId, fresh);
    return fresh;
  }

  const own = (userId: string): Quota | null => {
    const row = db.orm.select().from(quotas).where(eq(quotas.userId, userId)).get();
    return row ? { dailyUsd: row.dailyUsd, monthlyUsd: row.monthlyUsd } : null;
  };
  const effective = (userId: string): Quota =>
    own(userId) ?? instance.get('default_quota') ?? UNLIMITED;

  function status(userId: string): QuotaStatus {
    const q = effective(userId);
    const s = spent(userId);
    return {
      ...q,
      dailySpent: s.daily,
      monthlySpent: s.monthly,
      exhausted: limitReached(s.daily, q.dailyUsd) || limitReached(s.monthly, q.monthlyUsd),
    };
  }

  return {
    effective,
    own,
    status,

    assertWithin(userId) {
      const s = status(userId);
      if (!s.exhausted) return;
      const daily = limitReached(s.dailySpent, s.dailyUsd);
      const amount = (daily ? s.dailyUsd : s.monthlyUsd) ?? 0;
      throw new AppError(
        'quota_exceeded',
        `You've used your ${daily ? 'daily' : 'monthly'} budget on shared models (${usd(amount)}). It resets ${daily ? 'tomorrow' : 'next month'} (UTC). You can also add your own key in Settings → Providers.`,
        402,
        // The web words this in the user's language from these.
        { period: daily ? 'daily' : 'monthly', amountUsd: amount },
      );
    },

    recordSpend(userId, cost) {
      const hit = cache.get(userId);
      if (!hit) return;
      // A cache from an earlier day or month is dropped, not topped up.
      const day = new Date(clock.now()).toISOString().slice(0, 10);
      if (hit.day !== day) {
        cache.delete(userId);
        return;
      }
      hit.daily += cost;
      hit.monthly += cost;
    },

    setForUser(userId, q) {
      if (q === null) db.orm.delete(quotas).where(eq(quotas.userId, userId)).run();
      else {
        const row = { dailyUsd: q.dailyUsd, monthlyUsd: q.monthlyUsd, updatedAt: clock.now() };
        db.orm
          .insert(quotas)
          .values({ userId, ...row })
          .onConflictDoUpdate({ target: quotas.userId, set: row })
          .run();
      }
    },
  };
}
