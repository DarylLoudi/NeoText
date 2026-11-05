import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { quotasApi } from '../../lib/api/quotas';
import { qk } from '../../lib/query';
import { getGenerationsState, subscribeGenerations } from '../../state/generations';

export const quotaQuery = queryOptions({ queryKey: qk.quota, queryFn: quotasApi.mine });

/**
 * The admin's limit on shared models and what is spent, read again whenever an answer
 * finishes. Nothing is asked of the server while `enabled` is false.
 */
export function useQuota(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let streaming = new Set<string>();
    return subscribeGenerations(() => {
      const now = new Set<string>();
      for (const g of Object.values(getGenerationsState().byId)) {
        if (g.message.status === 'streaming') now.add(g.generationId);
      }
      const ended = [...streaming].some((id) => !now.has(id));
      streaming = now;
      if (ended) void qc.invalidateQueries({ queryKey: qk.quota });
    });
  }, [enabled, qc]);
  return useQuery({ ...quotaQuery, enabled });
}
