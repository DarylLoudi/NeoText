import { useQuery } from '@tanstack/react-query';
import { formatCost } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { updateSettings, useSettings } from '../../state/settings';
import { Switch } from '../../ui/Switch/Switch';
import { NumberField } from '../settings/NumberField';
import { Group, Row } from '../settings/SettingsParts';
import styles from './UsageDashboard.module.css';
import { budgetQuery } from './use-budget-alerts';

const LIMIT_MAX = 1_000_000;

/** Daily and monthly limits, the warning share and the hard stop, with what is spent so far. */
export function BudgetSettings({ locale }: { locale: string }) {
  const t = useT();
  const budget = useSettings((s) => s.settings.budget);
  const status = useQuery(budgetQuery);
  const cost = (n: number) => formatCost(n, locale);
  const line = (key: 'today' | 'month', spent: number, limit: number | null) =>
    limit === null
      ? t(`settings.usage.budget.${key}NoLimit`, { spent: cost(spent) })
      : t(`settings.usage.budget.${key}`, { spent: cost(spent), limit: cost(limit) });
  // Limits come from the settings on this page, so an edit shows at once; spend from the server.
  const spent = status.data;
  // Whole micro-dollars, as the server compares them, so float sums never fall just short.
  const reached = (n: number, limit: number | null) =>
    limit !== null && Math.round(n * 1e6) >= Math.round(limit * 1e6);
  const blocked =
    spent !== undefined &&
    budget.hardStop &&
    (reached(spent.dailySpent, budget.dailyUsd) || reached(spent.monthlySpent, budget.monthlyUsd));
  const save = (patch: Partial<typeof budget>) => updateSettings({ budget: patch });

  return (
    <Group title={t('settings.usage.budget.title')} intro={t('settings.usage.budget.intro')}>
      {spent ? (
        <div className={styles.lines}>
          <p>{line('today', spent.dailySpent, budget.dailyUsd)}</p>
          <p>{line('month', spent.monthlySpent, budget.monthlyUsd)}</p>
          {blocked ? (
            <p className={styles.blocked} role="status">
              {t('settings.usage.budget.blocked')}
            </p>
          ) : null}
        </div>
      ) : null}
      <Row>
        <NumberField
          label={t('settings.usage.budget.daily')}
          value={budget.dailyUsd}
          onCommit={(v) => save({ dailyUsd: v })}
          min={0}
          aboveMin
          max={LIMIT_MAX}
          step={0.01}
          hint={t('settings.usage.budget.limitHint')}
          error={t('settings.usage.budget.limitError')}
        />
        <NumberField
          label={t('settings.usage.budget.monthly')}
          value={budget.monthlyUsd}
          onCommit={(v) => save({ monthlyUsd: v })}
          min={0}
          aboveMin
          max={LIMIT_MAX}
          step={0.01}
          hint={t('settings.usage.budget.limitHint')}
          error={t('settings.usage.budget.limitError')}
        />
      </Row>
      <NumberField
        label={t('settings.usage.budget.warnAt')}
        value={budget.warnAtPercent}
        onCommit={(v) => {
          if (v !== null) save({ warnAtPercent: v });
        }}
        min={50}
        max={100}
        integer
        required
        hint={t('settings.usage.budget.warnHint')}
        error={t('settings.usage.budget.warnError')}
      />
      <Switch
        label={t('settings.usage.budget.hardStop')}
        hint={t('settings.usage.budget.hardStopHint')}
        checked={budget.hardStop}
        onChange={(hardStop) => save({ hardStop })}
      />
    </Group>
  );
}
