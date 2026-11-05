import { z } from 'zod';

/** One limit in USD; null is unlimited, 0 is no use of shared models at all. */
const limit = z.number().min(0).max(1_000_000).nullable();

/** What an admin lets one member spend on shared providers, per UTC day and UTC month. */
export const QuotaSchema = z.object({ dailyUsd: limit, monthlyUsd: limit });
export type Quota = z.infer<typeof QuotaSchema>;

/** A quota with what is spent so far. Unknown costs add nothing to the spend. */
export const QuotaStatusSchema = QuotaSchema.extend({
  dailySpent: z.number(),
  monthlySpent: z.number(),
  /** A limit is reached: the next turn on a shared provider is refused. */
  exhausted: z.boolean(),
});
export type QuotaStatus = z.infer<typeof QuotaStatusSchema>;

/** One member's own limit (null: they follow the instance default) and what applies to them. */
export const AdminQuotaResponseSchema = z.object({
  quota: QuotaSchema.nullable(),
  effective: QuotaSchema,
});
export type AdminQuotaResponse = z.infer<typeof AdminQuotaResponseSchema>;

/** null removes the member's own limit. */
export const PutQuotaBodySchema = z.object({ quota: QuotaSchema.nullable() });
export type PutQuotaBody = z.infer<typeof PutQuotaBodySchema>;
