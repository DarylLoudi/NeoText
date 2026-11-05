import { formatCost } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { Group } from '../settings/SettingsParts';
import styles from './UsageDashboard.module.css';
import { useQuota } from './use-quota';

/** What is left of the admin's limit on shared models; nothing shows when no limit applies. */
export function SharedQuota({ locale }: { locale: string }) {
  const t = useT();
  const q = useQuota(true).data;
  if (!q || (q.dailyUsd === null && q.monthlyUsd === null)) return null;
  const cost = (n: number) => formatCost(n, locale);
  const line = (key: 'today' | 'month', spent: number, limit: number | null) =>
    limit === null ? null : (
      <p>
        {t(`settings.usage.shared.${key}`, {
          spent: cost(spent),
          limit: cost(limit),
          left: cost(Math.max(0, limit - spent)),
        })}
      </p>
    );
  return (
    <Group title={t('settings.usage.shared.title')} intro={t('settings.usage.shared.intro')}>
      <div className={styles.lines}>
        {line('today', q.dailySpent, q.dailyUsd)}
        {line('month', q.monthlySpent, q.monthlyUsd)}
        {q.exhausted ? (
          <p className={styles.blocked} role="status">
            {t('settings.usage.shared.exhausted')}
          </p>
        ) : null}
      </div>
    </Group>
  );
}
