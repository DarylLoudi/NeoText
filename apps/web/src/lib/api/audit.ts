import { type AuditListResponse, AuditListResponseSchema } from '@neotext/shared';
import { apiFetch } from './client';

export interface AuditListParams {
  cursor?: string;
  /** An admin's view of everyone's events, optionally of one user. */
  all?: { userId?: string };
}

export const auditApi = {
  list: ({ cursor, all }: AuditListParams = {}): Promise<AuditListResponse> => {
    const query = new URLSearchParams();
    if (all) {
      query.set('all', '1');
      if (all.userId) query.set('userId', all.userId);
    }
    if (cursor) query.set('cursor', cursor);
    const text = query.toString();
    return apiFetch(`/audit${text ? `?${text}` : ''}`, { schema: AuditListResponseSchema });
  },
};
