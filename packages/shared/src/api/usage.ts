import { z } from 'zod';
import { TimeZoneSchema } from '../time-zone';

const DAY_MS = 86_400_000;
/** The longest range one summary covers. */
export const USAGE_MAX_RANGE_DAYS = 400;

/** `from` and `to` are epoch ms, `to` exclusive. Numbers arrive as query text, so coerced. */
export const UsageSummaryQuerySchema = z
  .object({
    from: z.coerce.number().int().nonnegative(),
    to: z.coerce.number().int().nonnegative(),
    groupBy: z.enum(['day', 'model']),
    timeZone: TimeZoneSchema,
  })
  .refine((q) => q.to > q.from, { message: 'The range ends before it starts.', path: ['to'] })
  .refine((q) => q.to - q.from <= USAGE_MAX_RANGE_DAYS * DAY_MS, {
    message: `Pick a range of at most ${USAGE_MAX_RANGE_DAYS} days.`,
    path: ['from'],
  });
export type UsageSummaryQuery = z.infer<typeof UsageSummaryQuerySchema>;

export const UsageSummaryRowSchema = z.object({
  /** `YYYY-MM-DD` in the query's time zone, or `providerId|modelId`. */
  key: z.string(),
  costUsd: z.number(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  requests: z.number(),
  /** Requests in this row whose cost is unknown; `costUsd` leaves them out. */
  unknownCostRequests: z.number(),
});
export type UsageSummaryRow = z.infer<typeof UsageSummaryRowSchema>;

export const UsageSummaryResponseSchema = z.object({
  /** Known costs only; requests whose cost is unknown are counted in `unknownCostRequests`. */
  totalCostUsd: z.number(),
  totalPromptTokens: z.number(),
  totalCompletionTokens: z.number(),
  webSearches: z.number(),
  requests: z.number(),
  unknownCostRequests: z.number(),
  rows: z.array(UsageSummaryRowSchema),
});
export type UsageSummaryResponse = z.infer<typeof UsageSummaryResponseSchema>;

export const BudgetQuerySchema = z.object({ timeZone: TimeZoneSchema.default('UTC') });

export const BudgetStatusSchema = z.object({
  dailySpent: z.number(),
  monthlySpent: z.number(),
  dailyLimit: z.number().nullable(),
  monthlyLimit: z.number().nullable(),
  warnAtPercent: z.number(),
  hardStop: z.boolean(),
  /** A limit is reached and `hardStop` is on: the next turn is refused. */
  blocked: z.boolean(),
});
export type BudgetStatus = z.infer<typeof BudgetStatusSchema>;
