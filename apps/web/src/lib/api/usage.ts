import {
  type BudgetStatus,
  BudgetStatusSchema,
  type UsageSummaryQuery,
  type UsageSummaryResponse,
  UsageSummaryResponseSchema,
} from '@neotext/shared';
import { apiFetch } from './client';

/** The browser's IANA time zone; budget days and chart days follow it. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export const usageApi = {
  summary: (q: UsageSummaryQuery): Promise<UsageSummaryResponse> => {
    const params = new URLSearchParams({
      from: String(q.from),
      to: String(q.to),
      groupBy: q.groupBy,
      timeZone: q.timeZone,
    });
    return apiFetch(`/usage/summary?${params}`, { schema: UsageSummaryResponseSchema });
  },
  budget: (timeZone: string): Promise<BudgetStatus> =>
    apiFetch(`/usage/budget?${new URLSearchParams({ timeZone })}`, {
      schema: BudgetStatusSchema,
    }),
};
