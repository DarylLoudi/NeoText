import type { UsageSummaryQuery, UsageSummaryResponse } from '@neotext/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { browserTimeZone, usageApi } from '../../lib/api/usage';
import { formatCost, formatTokens } from '../../lib/format';
import { getLocale, useT } from '../../lib/i18n';
import { qk } from '../../lib/query';
import { providersQuery } from '../settings/use-providers';
import { ChoiceGroup } from '../sidebar/ChoiceGroup';
import { BudgetSettings } from './BudgetSettings';
import { SharedQuota } from './SharedQuota';
import { type ChartDay, UsageChart } from './UsageChart';
import styles from './UsageDashboard.module.css';

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The last `days` local days, today included: `[from, to)` and every day key in order. */
function rangeOf(days: number, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const keys = Array.from({ length: days }, (_, i) => keyOf(new Date(y, m, d - days + 1 + i)));
  return {
    from: new Date(y, m, d - days + 1).getTime(),
    to: new Date(y, m, d + 1).getTime(),
    keys,
  };
}

function useSummary(q: UsageSummaryQuery) {
  return useQuery({
    queryKey: qk.usageSummary(q),
    queryFn: () => usageApi.summary(q),
    placeholderData: keepPreviousData,
  });
}

function Totals({ s }: { s: UsageSummaryResponse }) {
  const t = useT();
  return (
    <div className={styles.lines}>
      <p className={styles.spent}>
        {t('settings.usage.spent', { cost: formatCost(s.totalCostUsd) })}
      </p>
      <p>
        {t('settings.usage.tokens', {
          prompt: formatTokens(s.totalPromptTokens),
          completion: formatTokens(s.totalCompletionTokens),
        })}
      </p>
      <p>
        {t('settings.usage.activity', {
          requests: t('settings.usage.requestCount', { count: s.requests }),
          searches: t('settings.usage.searchCount', { count: s.webSearches }),
        })}
      </p>
      {s.unknownCostRequests > 0 ? (
        <p className={styles.muted}>
          {t('settings.usage.unknownCost', { count: s.unknownCostRequests })}
        </p>
      ) : null}
    </div>
  );
}

/** The usage page: range, totals, cost per day, usage by model, and the budget. */
export function UsageDashboard() {
  const t = useT();
  const locale = getLocale();
  const chartTitle = useId();
  const [range, setRange] = useState<Range>(7);
  const { from, to, keys } = rangeOf(range);
  const timeZone = browserTimeZone();
  const daily = useSummary({ from, to, groupBy: 'day', timeZone });
  const models = useSummary({ from, to, groupBy: 'model', timeZone });
  const providers = useQuery(providersQuery);
  const nameOf = (id: string) => providers.data?.find((p) => p.id === id)?.name ?? id;

  const byKey = new Map((daily.data?.rows ?? []).map((r) => [r.key, r]));
  const days: ChartDay[] = keys.map((key) => ({
    key,
    costUsd: byKey.get(key)?.costUsd ?? 0,
    requests: byKey.get(key)?.requests ?? 0,
  }));
  const dayFormat = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const failed = daily.isError || models.isError;
  const stale = daily.isPlaceholderData || models.isPlaceholderData;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('settings.usage.title')}</h1>
        <p className={styles.muted}>{t('settings.usage.intro')}</p>
      </header>
      <div className={styles.filters}>
        <ChoiceGroup
          legend={t('settings.usage.range')}
          value={String(range)}
          onChange={(v) => setRange(Number(v) as Range)}
          options={RANGES.map((n) => ({ value: String(n), label: t(`settings.usage.days${n}`) }))}
        />
      </div>
      {failed ? (
        <p className={styles.error} role="alert">
          {t('settings.usage.loadFailed')}
        </p>
      ) : null}
      {daily.data ? (
        <div className={styles.body} data-stale={stale || undefined}>
          <Totals s={daily.data} />
          <section className={styles.section}>
            <h2 id={chartTitle} className={styles.sectionTitle}>
              {t('settings.usage.chartTitle')}
            </h2>
            <UsageChart days={days} labelledBy={chartTitle} locale={locale} />
            <details className={styles.details}>
              <summary>{t('settings.usage.dailyTable')}</summary>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col" className={styles.text}>
                      {t('settings.usage.date')}
                    </th>
                    <th scope="col">{t('settings.usage.requests')}</th>
                    <th scope="col">{t('settings.usage.cost')}</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.key}>
                      <th scope="row" className={styles.text}>
                        {dayFormat.format(new Date(`${d.key}T00:00:00`))}
                      </th>
                      <td>{d.requests}</td>
                      <td>{formatCost(d.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>
          <section className={styles.section}>
            {models.data && models.data.rows.length > 0 ? (
              <table className={styles.table}>
                <caption className={styles.caption}>{t('settings.usage.tableCaption')}</caption>
                <thead>
                  <tr>
                    <th scope="col" className={styles.text}>
                      {t('settings.usage.model')}
                    </th>
                    <th scope="col" className={styles.text}>
                      {t('settings.usage.provider')}
                    </th>
                    <th scope="col">{t('settings.usage.requests')}</th>
                    <th scope="col">{t('settings.usage.promptTokens')}</th>
                    <th scope="col">{t('settings.usage.completionTokens')}</th>
                    <th scope="col">{t('settings.usage.cost')}</th>
                  </tr>
                </thead>
                <tbody>
                  {models.data.rows.map((r) => {
                    const cut = r.key.indexOf('|');
                    const providerId = r.key.slice(0, cut);
                    return (
                      <tr key={r.key}>
                        <th scope="row" className={`${styles.text} ${styles.model}`}>
                          {r.key.slice(cut + 1)}
                        </th>
                        <td className={styles.text}>{nameOf(providerId)}</td>
                        <td>{r.requests}</td>
                        <td>{formatTokens(r.promptTokens)}</td>
                        <td>{formatTokens(r.completionTokens)}</td>
                        <td>
                          {r.unknownCostRequests === r.requests
                            ? t('common.unknown')
                            : formatCost(r.costUsd)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className={styles.muted}>{t('settings.usage.empty')}</p>
            )}
          </section>
        </div>
      ) : null}
      <SharedQuota locale={locale} />
      <BudgetSettings locale={locale} />
    </div>
  );
}
