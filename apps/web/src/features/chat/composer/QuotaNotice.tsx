import type { ModelRef, QuotaStatus } from '@neotext/shared';
import { useQuery } from '@tanstack/react-query';
import { sharedQuotaText } from '../../../lib/api/error-text';
import { providersQuery } from '../../settings/use-providers';
import { useQuota } from '../../usage/use-quota';
import styles from './QuotaNotice.module.css';

/** Whole micro-dollars, as the server compares them. */
const reached = (spent: number, limit: number | null) =>
  limit !== null && Math.round(spent * 1e6) >= Math.round(limit * 1e6);

/** The reached limit to name, the daily one first, as the server does. */
function reachedLimit(q: QuotaStatus): { period: 'daily' | 'monthly'; amount: number } | null {
  if (q.dailyUsd !== null && reached(q.dailySpent, q.dailyUsd)) {
    return { period: 'daily', amount: q.dailyUsd };
  }
  if (q.monthlyUsd !== null && reached(q.monthlySpent, q.monthlyUsd)) {
    return { period: 'monthly', amount: q.monthlyUsd };
  }
  return null;
}

/**
 * Above the composer: the admin's budget on shared models is used up, so a send to one is
 * refused. Own providers are never limited, so nothing shows for them.
 */
export function QuotaNotice({ targets }: { targets: ModelRef[] }) {
  const providers = useQuery(providersQuery);
  const sharedIds = new Set((providers.data ?? []).filter((p) => p.shared).map((p) => p.id));
  const usesShared = targets.some((ref) => sharedIds.has(ref.providerId));
  const quota = useQuota(usesShared);
  const hit = usesShared && quota.data?.exhausted ? reachedLimit(quota.data) : null;
  if (!hit) return null;
  return (
    <p className={styles.notice} role="status">
      {sharedQuotaText(hit.period, hit.amount)}
    </p>
  );
}
