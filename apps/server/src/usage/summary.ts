import type { UsageSummaryQuery, UsageSummaryResponse, UsageSummaryRow } from '@neotext/shared';
import { and, eq, gte, lt, ne, type SQL, sql } from 'drizzle-orm';
import type { DbHandle } from '../db/client';
import { usageEvents } from '../db/schema';

/**
 * Every time zone's offset is a multiple of 15 minutes, so a 15-minute UTC bucket never
 * straddles a local midnight (half-hour zones such as Asia/Kolkata included).
 */
const BUCKET_MS = 900_000;

const sums = {
  costUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)`,
  promptTokens: sql<number>`coalesce(sum(${usageEvents.promptTokens}), 0)`,
  completionTokens: sql<number>`coalesce(sum(${usageEvents.completionTokens}), 0)`,
  requests: sql<number>`count(*)`,
  unknownCostRequests: sql<number>`coalesce(sum(${usageEvents.costUsd} is null), 0)`,
};

/**
 * Model calls of one user in `[from, to)`. Search backend rows are left out: they are counted
 * as web searches, not as requests, and their cost is never known.
 */
function modelCalls(userId: string, from: number, to: number): SQL | undefined {
  return and(
    eq(usageEvents.userId, userId),
    gte(usageEvents.createdAt, from),
    lt(usageEvents.createdAt, to),
    ne(usageEvents.kind, 'search'),
  );
}

/** Known model-call cost per user in `[from, to)`; unknown costs add nothing. */
export function costByUser(db: DbHandle, from: number, to: number): Map<string, number> {
  const rows = db.orm
    .select({ userId: usageEvents.userId, costUsd: sums.costUsd })
    .from(usageEvents)
    .where(
      and(
        gte(usageEvents.createdAt, from),
        lt(usageEvents.createdAt, to),
        ne(usageEvents.kind, 'search'),
      ),
    )
    .groupBy(usageEvents.userId)
    .all();
  return new Map(rows.map((r) => [r.userId, r.costUsd]));
}

/** `YYYY-MM-DD` of an instant in `timeZone`. */
export function localDayFormatter(timeZone: string): (ms: number) => string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return (ms) => {
    const parts = fmt.formatToParts(ms);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  };
}

type Bucketed = Omit<UsageSummaryRow, 'key'>;

/** Sums per local day in `timeZone`, from 15-minute UTC buckets. */
export function dailyTotals(
  db: DbHandle,
  userId: string,
  from: number,
  to: number,
  timeZone: string,
): Map<string, Bucketed> {
  const bucket = sql<number>`${usageEvents.createdAt} / ${sql.raw(String(BUCKET_MS))}`;
  const rows = db.orm
    .select({ bucket, ...sums })
    .from(usageEvents)
    .where(modelCalls(userId, from, to))
    .groupBy(bucket)
    .all();
  const dayOf = localDayFormatter(timeZone);
  const days = new Map<string, Bucketed>();
  for (const { bucket: b, ...r } of rows) {
    const key = dayOf(b * BUCKET_MS);
    const day = days.get(key);
    if (!day) {
      days.set(key, { ...r });
      continue;
    }
    day.costUsd += r.costUsd;
    day.promptTokens += r.promptTokens;
    day.completionTokens += r.completionTokens;
    day.requests += r.requests;
    day.unknownCostRequests += r.unknownCostRequests;
  }
  return days;
}

function byModel(db: DbHandle, userId: string, q: UsageSummaryQuery): UsageSummaryRow[] {
  return db.orm
    .select({ providerId: usageEvents.providerId, modelId: usageEvents.modelId, ...sums })
    .from(usageEvents)
    .where(modelCalls(userId, q.from, q.to))
    .groupBy(usageEvents.providerId, usageEvents.modelId)
    .all()
    .map(({ providerId, modelId, ...r }) => ({
      key: `${providerId}|${modelId}`,
      ...r,
    }))
    .sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests || a.key.localeCompare(b.key));
}

/** Usage of one user in `[from, to)`, per local day or per model, with totals. */
export function summarizeUsage(
  db: DbHandle,
  userId: string,
  q: UsageSummaryQuery,
): UsageSummaryResponse {
  const days = dailyTotals(db, userId, q.from, q.to, q.timeZone);
  const all = [...days.values()];
  const total = (pick: (d: Bucketed) => number) => all.reduce((n, d) => n + pick(d), 0);
  const searches = db.orm
    .select({ n: sql<number>`coalesce(sum(${usageEvents.webSearchRequests}), 0)` })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        gte(usageEvents.createdAt, q.from),
        lt(usageEvents.createdAt, q.to),
      ),
    )
    .get();
  const rows =
    q.groupBy === 'model'
      ? byModel(db, userId, q)
      : [...days.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, r]) => ({ key, ...r }));
  return {
    totalCostUsd: total((d) => d.costUsd),
    totalPromptTokens: total((d) => d.promptTokens),
    totalCompletionTokens: total((d) => d.completionTokens),
    webSearches: searches?.n ?? 0,
    requests: total((d) => d.requests),
    unknownCostRequests: total((d) => d.unknownCostRequests),
    rows,
  };
}
