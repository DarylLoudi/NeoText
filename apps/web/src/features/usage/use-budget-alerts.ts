import type { BudgetStatus } from '@neotext/shared';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { browserTimeZone, usageApi } from '../../lib/api/usage';
import { translate } from '../../lib/i18n';
import { qk } from '../../lib/query';
import { getGenerationsState, subscribeGenerations } from '../../state/generations';
import { useSettings } from '../../state/settings';
import { toast } from '../../ui';

export const budgetQuery = queryOptions({
  queryKey: qk.budget,
  queryFn: () => usageApi.budget(browserTimeZone()),
});

const STORAGE_KEY = 'neotext:budget-warned';
type Warned = { daily?: string; monthly?: string };

/** Kept in memory too, so a blocked storage still warns only once per page load and period. */
let memory: Warned = {};

function readWarned(): Warned {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...memory, ...(JSON.parse(raw) as Warned) } : memory;
  } catch {
    return memory;
  }
}

function writeWarned(next: Warned): void {
  memory = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage is off (private window): the in-memory copy is enough.
  }
}

/** Today in local time: `YYYY-MM-DD`; its first 7 characters name the month. */
function localDay(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Toasts each limit that passed its warning share, at most once per day or month. */
function warnFor(status: BudgetStatus): void {
  const day = localDay();
  const periods = [
    { name: 'daily', key: day, spent: status.dailySpent, limit: status.dailyLimit },
    {
      name: 'monthly',
      key: day.slice(0, 7),
      spent: status.monthlySpent,
      limit: status.monthlyLimit,
    },
  ] as const;
  let warned = readWarned();
  for (const p of periods) {
    if (p.limit === null || p.limit <= 0 || warned[p.name] === p.key) continue;
    const percent = Math.floor((p.spent / p.limit) * 100 + 1e-9);
    if (percent < status.warnAtPercent) continue;
    warned = { ...warned, [p.name]: p.key };
    writeWarned(warned);
    toast({
      message: translate(`settings.usage.alerts.${p.name}`, { percent: Math.min(percent, 100) }),
    });
  }
}

/**
 * Reads the budget again whenever an answer finishes and warns at the user's share of a limit.
 * Mounted once, in the app shell. Nothing is asked of the server while no limit is set.
 */
export function useBudgetAlerts(): void {
  const qc = useQueryClient();
  const limited = useSettings(
    (s) => s.settings.budget.dailyUsd !== null || s.settings.budget.monthlyUsd !== null,
  );
  const status = useQuery({ ...budgetQuery, enabled: limited });

  useEffect(() => {
    if (!limited) return;
    let streaming = new Set<string>();
    return subscribeGenerations(() => {
      const { byId } = getGenerationsState();
      const now = new Set<string>();
      for (const g of Object.values(byId)) {
        if (g.message.status === 'streaming') now.add(g.generationId);
      }
      const ended = [...streaming].some((id) => !now.has(id));
      streaming = now;
      if (ended) void qc.invalidateQueries({ queryKey: qk.budget });
    });
  }, [limited, qc]);

  // Every read counts, even an unchanged one: the day may have turned since the last.
  const { data, dataUpdatedAt } = status;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new read re-checks the same data
  useEffect(() => {
    if (data) warnFor(data);
  }, [data, dataUpdatedAt]);
}

/** For tests: forgets which periods were warned about. */
export function resetBudgetAlertsForTests(): void {
  memory = {};
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored.
  }
}
