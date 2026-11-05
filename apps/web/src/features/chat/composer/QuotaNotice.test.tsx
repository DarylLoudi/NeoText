import type { ProviderPublic, QuotaStatus } from '@neotext/shared';
import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test, vi } from 'vitest';
import { server } from '../../../test/msw';
import { renderWithClient } from '../../../test/renderWithClient';
import { QuotaNotice } from './QuotaNotice';

const provider = (id: string, shared: boolean): ProviderPublic => ({
  id,
  category: 'llm',
  kind: 'openai-compatible',
  name: id,
  baseUrl: '',
  hasKey: true,
  keyHint: null,
  enabled: true,
  shared,
  manualModels: [],
  createdAt: 0,
  updatedAt: 0,
});
const status = (over: Partial<QuotaStatus> = {}): QuotaStatus => ({
  dailyUsd: 1,
  monthlyUsd: null,
  dailySpent: 1.2,
  monthlySpent: 1.2,
  exhausted: true,
  ...over,
});

let quotaReads = 0;
beforeEach(() => {
  quotaReads = 0;
  server.use(
    http.get('/api/providers', () =>
      HttpResponse.json({ providers: [provider('lab', true), provider('mine', false)] }),
    ),
  );
});
const serve = (q: QuotaStatus) =>
  server.use(
    http.get('/api/usage/quota', () => {
      quotaReads += 1;
      return HttpResponse.json(q);
    }),
  );

test('shows when exhausted on a shared model', async () => {
  serve(status());
  renderWithClient(<QuotaNotice targets={[{ providerId: 'lab', modelId: 'm1' }]} />);
  expect(await screen.findByRole('status')).toHaveTextContent(
    "You've used your daily budget on shared models ($1.00). It resets tomorrow (UTC). You can also add your own key in Settings → Providers.",
  );
});

test('names the monthly budget when only that one is used up', async () => {
  serve(status({ dailyUsd: 5, monthlyUsd: 3, monthlySpent: 3.5 }));
  renderWithClient(<QuotaNotice targets={[{ providerId: 'lab', modelId: 'm1' }]} />);
  expect(await screen.findByRole('status')).toHaveTextContent(
    'monthly budget on shared models ($3.00). It resets next month',
  );
});

test('stays hidden for a model on your own provider, and asks nothing', async () => {
  serve(status());
  renderWithClient(<QuotaNotice targets={[{ providerId: 'mine', modelId: 'm1' }]} />);
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(quotaReads).toBe(0);
});

test('stays hidden while budget is left', async () => {
  serve(status({ dailySpent: 0.2, exhausted: false }));
  renderWithClient(<QuotaNotice targets={[{ providerId: 'lab', modelId: 'm1' }]} />);
  await vi.waitFor(() => expect(quotaReads).toBe(1));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('compare shows it when any target is shared', async () => {
  serve(status());
  renderWithClient(
    <QuotaNotice
      targets={[
        { providerId: 'mine', modelId: 'm1' },
        { providerId: 'lab', modelId: 'm1' },
      ]}
    />,
  );
  expect(await screen.findByRole('status')).toBeInTheDocument();
});
