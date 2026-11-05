import type { BudgetStatus, UserSettings } from '@neotext/shared';
import type { DbHandle } from '../db/client';
import { AppError } from '../http/errors';
import { dailyTotals, localDayFormatter } from './summary';

const DAY_MS = 86_400_000;

/** Whole micro-dollars, so float sums such as 0.1 + 0.7 still meet a 0.8 limit. */
const micros = (usd: number) => Math.round(usd * 1e6);

/** The spend meets the limit; no limit is never met. */
export function limitReached(spent: number, limit: number | null): boolean {
  return limit !== null && micros(spent) >= micros(limit);
}
/** Covers the longest month plus a day either side for any time zone offset. */
const LOOKBACK_MS = 33 * DAY_MS;

/**
 * Known spend today and this month in `timeZone`; unknown costs add nothing. `blocked` when a
 * limit is reached and the hard stop is on.
 */
export function budgetStatus(
  db: DbHandle,
  userId: string,
  budget: UserSettings['budget'],
  now: number,
  timeZone: string,
): BudgetStatus {
  const today = localDayFormatter(timeZone)(now);
  const month = today.slice(0, 7);
  let dailySpent = 0;
  let monthlySpent = 0;
  for (const [day, totals] of dailyTotals(db, userId, now - LOOKBACK_MS, now + DAY_MS, timeZone)) {
    if (day === today) dailySpent += totals.costUsd;
    if (day.startsWith(month)) monthlySpent += totals.costUsd;
  }
  return {
    dailySpent,
    monthlySpent,
    dailyLimit: budget.dailyUsd,
    monthlyLimit: budget.monthlyUsd,
    warnAtPercent: budget.warnAtPercent,
    hardStop: budget.hardStop,
    blocked:
      budget.hardStop &&
      (limitReached(dailySpent, budget.dailyUsd) || limitReached(monthlySpent, budget.monthlyUsd)),
  };
}

/** Cents when the limit is whole cents ("$0.50"), else as set ("$0.001"). */
export function usd(n: number): string {
  const cents = n * 100;
  return `$${Math.abs(cents - Math.round(cents)) < 1e-9 ? n.toFixed(2) : String(n)}`;
}

/** Refuses a new turn once a limit is reached with the hard stop on. */
export function assertBudget(
  db: DbHandle,
  userId: string,
  budget: UserSettings['budget'],
  now: number,
  timeZone: string,
): void {
  if (!budget.hardStop || (budget.dailyUsd === null && budget.monthlyUsd === null)) return;
  const s = budgetStatus(db, userId, budget, now, timeZone);
  if (!s.blocked) return;
  const daily = limitReached(s.dailySpent, s.dailyLimit);
  const [period, limit] = daily ? ['daily', s.dailyLimit] : ['monthly', s.monthlyLimit];
  throw new AppError(
    'quota_exceeded',
    `You've reached your ${period} budget of ${usd(limit ?? 0)}. Raise it in Usage, or wait for the next period.`,
    402,
    // The web words this in the user's language from these.
    { period, limitUsd: limit ?? 0 },
  );
}
