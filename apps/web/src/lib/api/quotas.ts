import {
  type AdminQuotaResponse,
  AdminQuotaResponseSchema,
  type Quota,
  type QuotaStatus,
  QuotaStatusSchema,
} from '@neotext/shared';
import { apiFetch } from './client';

const adminQuota = (userId: string) => `/admin/quotas/${encodeURIComponent(userId)}`;

export const quotasApi = {
  /** What the signed-in user has spent on shared models, and what is left. */
  mine: (): Promise<QuotaStatus> => apiFetch('/usage/quota', { schema: QuotaStatusSchema }),
  /** Admin: one member's own limit (null: the default applies) and the limit in force. */
  get: (userId: string): Promise<AdminQuotaResponse> =>
    apiFetch(adminQuota(userId), { schema: AdminQuotaResponseSchema }),
  /** Admin: null removes the member's own limit. */
  put: (userId: string, quota: Quota | null): Promise<AdminQuotaResponse> =>
    apiFetch(adminQuota(userId), {
      method: 'PUT',
      body: { quota },
      schema: AdminQuotaResponseSchema,
    }),
};
