import type { BudgetStatus, ProviderPublic, UsageSummaryResponse } from '@neotext/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { setLocale } from '../../lib/i18n';
import { resetFakeSettings, setFakeSettings, updateSettings } from '../../test/fake-settings';
import { server } from '../../test/msw';
import { renderWithClient } from '../../test/renderWithClient';
import { UsageDashboard } from './UsageDashboard';

vi.mock('../../state/settings', () => import('../../test/fake-settings'));

const totals = {
  totalCostUsd: 1.25,
  totalPromptTokens: 12_000,
  totalCompletionTokens: 3_400,
  webSearches: 4,
  requests: 9,
  unknownCostRequests: 2,
};
const byDay: UsageSummaryResponse = {
  ...totals,
  rows: [
    {
      key: '2026-11-02',
      costUsd: 0.5,
      promptTokens: 6000,
      completionTokens: 1000,
      requests: 4,
      unknownCostRequests: 0,
    },
    {
      key: '2026-11-03',
      costUsd: 0.75,
      promptTokens: 6000,
      completionTokens: 2400,
      requests: 5,
      unknownCostRequests: 2,
    },
  ],
};
const byModel: UsageSummaryResponse = {
  ...totals,
  rows: [
    {
      key: 'prv_a|gpt-big',
      costUsd: 1.2,
      promptTokens: 11_000,
      completionTokens: 3000,
      requests: 7,
      unknownCostRequests: 0,
    },
    {
      key: 'prv_b|local',
      costUsd: 0,
      promptTokens: 1000,
      completionTokens: 400,
      requests: 2,
      unknownCostRequests: 2,
    },
  ],
};
const budget: BudgetStatus = {
  dailySpent: 0.1,
  monthlySpent: 1.25,
  dailyLimit: 0.5,
  monthlyLimit: null,
  warnAtPercent: 80,
  hardStop: false,
  blocked: false,
};
const provider: ProviderPublic = {
  id: 'prv_a',
  category: 'llm',
  kind: 'openai-compatible',
  name: 'Mock AI',
  baseUrl: 'http://localhost:9999',
  hasKey: false,
  keyHint: null,
  enabled: true,
  shared: false,
  manualModels: [],
  createdAt: 1,
  updatedAt: 1,
};

let queries: URLSearchParams[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 4, 12, 0) });
  resetFakeSettings();
  queries = [];
  server.use(
    http.get('/api/usage/summary', ({ request }) => {
      const q = new URL(request.url).searchParams;
      queries.push(q);
      return HttpResponse.json(q.get('groupBy') === 'model' ? byModel : byDay);
    }),
    http.get('/api/usage/budget', () => HttpResponse.json(budget)),
    http.get('/api/providers', () => HttpResponse.json({ providers: [provider] })),
  );
});
afterEach(() => {
  vi.useRealTimers();
  setLocale('en');
});

test('renders totals, chart and table', async () => {
  renderWithClient(<UsageDashboard />);
  expect(await screen.findByText('$1.25 spent')).toBeInTheDocument();
  expect(screen.getByText('12k prompt tokens, 3.4k completion tokens')).toBeInTheDocument();
  expect(screen.getByText('9 requests, 4 web searches')).toBeInTheDocument();
  expect(
    screen.getByText('2 requests have no known cost and are not in the total.'),
  ).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Cost per day' })).toBeInTheDocument();
  const table = screen.getByRole('table', { name: 'Usage by model' });
  const rows = within(table).getAllByRole('row');
  expect(rows).toHaveLength(3);
  await waitFor(() => expect(within(rows[1] as HTMLElement).getByText('Mock AI')).toBeVisible());
  expect(within(rows[1] as HTMLElement).getByText('gpt-big')).toBeInTheDocument();
  expect(within(rows[1] as HTMLElement).getByText('$1.20')).toBeInTheDocument();
  // A model whose every cost is unknown shows that, never $0.
  expect(within(rows[2] as HTMLElement).getByText('local')).toBeInTheDocument();
  expect(within(rows[2] as HTMLElement).getByText('Unknown')).toBeInTheDocument();
  expect(within(rows[2] as HTMLElement).queryByText('$0')).toBeNull();
  // The last 7 local days, to the end of today, in the browser's time zone.
  const q = queries[0] as URLSearchParams;
  expect(Number(q.get('from'))).toBe(new Date(2026, 9, 29).getTime());
  expect(Number(q.get('to'))).toBe(new Date(2026, 10, 5).getTime());
  expect(q.get('timeZone')).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
});

test('the range picker asks for a longer range', async () => {
  const { user } = renderWithClient(<UsageDashboard />);
  await screen.findByText('$1.25 spent');
  await user.click(screen.getByRole('radio', { name: '30 days' }));
  await waitFor(() =>
    expect(queries.some((q) => Number(q.get('from')) === new Date(2026, 9, 6).getTime())).toBe(
      true,
    ),
  );
  expect(await screen.findAllByRole('img', { name: /requests?$/ })).toHaveLength(30);
});

test('chart bars have accessible names', async () => {
  const { user } = renderWithClient(<UsageDashboard />);
  const chart = await screen.findByRole('group', { name: 'Cost per day' });
  await waitFor(() => expect(within(chart).getAllByRole('img')).toHaveLength(7));
  const bars = within(chart).getAllByRole('img');
  expect(bars[5]).toHaveAccessibleName(/Nov 3.*\$0\.75, 5 requests/);
  expect(bars[0]).toHaveAccessibleName(/Oct 29.*\$0, 0 requests/);
  // One tab stop; arrow keys move between the days and show the tooltip.
  expect(bars.filter((b) => b.getAttribute('tabindex') === '0')).toHaveLength(1);
  (bars[6] as HTMLElement).focus();
  await user.keyboard('{ArrowLeft}');
  expect(bars[5]).toHaveFocus();
  expect(screen.getByTestId('usage-tooltip')).toHaveTextContent('$0.75');
  await user.keyboard('{Home}');
  expect(bars[0]).toHaveFocus();
});

test('budget limits save to settings', async () => {
  setFakeSettings({ settings: { budget: { dailyUsd: 0.5 } } });
  const { user } = renderWithClient(<UsageDashboard />);
  expect(await screen.findByText('Today: $0.10 of $0.50')).toBeInTheDocument();
  expect(screen.getByText('This month: $1.25, no limit')).toBeInTheDocument();
  const monthly = screen.getByRole('spinbutton', { name: 'Monthly limit (USD)' });
  await user.type(monthly, '20{Enter}');
  expect(updateSettings).toHaveBeenCalledWith({ budget: { monthlyUsd: 20 } });
  await user.click(screen.getByRole('switch', { name: 'Stop new messages at the limit' }));
  expect(updateSettings).toHaveBeenCalledWith({ budget: { hardStop: true } });
});

const ID_LIMIT_ERROR = 'Masukkan jumlah di atas 0, atau kosongkan kotaknya.';

test('a budget of 0 or less is refused with how to set no limit', async () => {
  setLocale('id');
  const { user } = renderWithClient(<UsageDashboard />);
  const daily = await screen.findByRole('spinbutton', { name: 'Batas harian (USD)' });
  await user.type(daily, '0{Enter}');
  expect(daily).toHaveAccessibleDescription(expect.stringContaining(ID_LIMIT_ERROR));
  await user.clear(daily);
  await user.type(daily, '-5{Enter}');
  expect(daily).toHaveAccessibleDescription(expect.stringContaining(ID_LIMIT_ERROR));
  expect(updateSettings).not.toHaveBeenCalled();
  setLocale('en');
});
