import type { BudgetStatus } from '@neotext/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createQueryClient } from '../../lib/query';
import { flushEvents, ingestEvents, resetGenerations } from '../../state/generations';
import { eventsFor, msg } from '../../test/chat-fixtures';
import { resetFakeSettings, setFakeSettings } from '../../test/fake-settings';
import { server } from '../../test/msw';
import { dismissToast, getToasts } from '../../ui/Toast/toastStore';
import { resetBudgetAlertsForTests, useBudgetAlerts } from './use-budget-alerts';

vi.mock('../../state/settings', () => import('../../test/fake-settings'));

let status: BudgetStatus;
let reads = 0;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 4, 12, 0) });
  resetFakeSettings();
  resetGenerations();
  resetBudgetAlertsForTests();
  for (const t of getToasts()) dismissToast(t.id);
  setFakeSettings({ settings: { budget: { dailyUsd: 0.5, monthlyUsd: 10 } } });
  reads = 0;
  status = {
    dailySpent: 0.1,
    monthlySpent: 1,
    dailyLimit: 0.5,
    monthlyLimit: 10,
    warnAtPercent: 80,
    hardStop: false,
    blocked: false,
  };
  server.use(
    http.get('/api/usage/budget', () => {
      reads += 1;
      return HttpResponse.json(status);
    }),
  );
});
afterEach(() => vi.useRealTimers());

function mount() {
  const qc = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return renderHook(() => useBudgetAlerts(), { wrapper });
}

let gen = 0;
/** One answer that starts and finishes, as the stream delivers it. */
function finishOne() {
  gen += 1;
  const e = eventsFor(`gen_${gen}`);
  const id = `msg_${gen}`;
  act(() => {
    ingestEvents([e.started(msg({ id, status: 'streaming' }))]);
    flushEvents();
    ingestEvents([e.finished(msg({ id, status: 'complete' }))]);
    flushEvents();
  });
}
const messages = () => getToasts().map((t) => t.message);

test('warns once per day per limit', async () => {
  mount();
  await waitFor(() => expect(reads).toBe(1));
  expect(messages()).toEqual([]);

  status = { ...status, dailySpent: 0.4 };
  finishOne();
  await waitFor(() => expect(messages()).toEqual(["You've used 80% of today's budget."]));

  status = { ...status, dailySpent: 0.45 };
  finishOne();
  await waitFor(() => expect(reads).toBe(3));
  expect(messages()).toHaveLength(1);

  status = { ...status, monthlySpent: 9 };
  finishOne();
  await waitFor(() => expect(messages()).toHaveLength(2));
  expect(messages()[1]).toBe("You've used 90% of this month's budget.");

  // The next day the daily warning may come again; the monthly one may not.
  vi.setSystemTime(new Date(2026, 10, 5, 9, 0));
  finishOne();
  await waitFor(() => expect(messages()).toHaveLength(3));
  expect(messages()[2]).toBe("You've used 90% of today's budget.");
});

test('no limits, no requests', async () => {
  setFakeSettings({ settings: { budget: { dailyUsd: null, monthlyUsd: null } } });
  mount();
  finishOne();
  await new Promise((r) => setTimeout(r, 50));
  expect(reads).toBe(0);
});
