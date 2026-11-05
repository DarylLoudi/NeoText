import type { SessionInfo } from '@neotext/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test } from 'vitest';
import { server } from '../../../test/msw';
import { renderWithClient } from '../../../test/renderWithClient';
import { SessionsPanel } from './SessionsPanel';

const NOW = Date.now();
const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';

let items: SessionInfo[];
let revoked: string[];
let revokedOthers: number;

const session = (id: string, over: Partial<SessionInfo> = {}): SessionInfo => ({
  id,
  createdAt: NOW - 86_400_000,
  lastSeenAt: NOW,
  expiresAt: NOW + 86_400_000,
  userAgent: null,
  current: false,
  ...over,
});

beforeEach(() => {
  items = [
    session('s_here', { userAgent: CHROME_WIN, current: true }),
    session('s_phone', { userAgent: SAFARI_IPHONE, lastSeenAt: NOW - 3_600_000 }),
  ];
  revoked = [];
  revokedOthers = 0;
  server.use(
    http.get('/api/auth/sessions', () => HttpResponse.json({ items })),
    http.delete('/api/auth/sessions/:id', ({ params }) => {
      revoked.push(String(params.id));
      items = items.filter((s) => s.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('/api/auth/sessions/revoke-others', () => {
      revokedOthers += 1;
      items = items.filter((s) => s.current);
      return new HttpResponse(null, { status: 204 });
    }),
  );
});

test('lists devices and marks this one', async () => {
  renderWithClient(<SessionsPanel />);
  const here = (await screen.findByText('Chrome on Windows')).closest('li') as HTMLElement;
  expect(within(here).getByText('This device')).toBeInTheDocument();
  expect(within(here).queryByRole('button')).not.toBeInTheDocument();
  const phone = screen.getByText('Safari on iPhone').closest('li') as HTMLElement;
  expect(within(phone).queryByText('This device')).not.toBeInTheDocument();
  expect(within(phone).getByText(/last active/i)).toBeInTheDocument();
});

test('signs out one other device', async () => {
  renderWithClient(<SessionsPanel />);
  const phone = (await screen.findByText('Safari on iPhone')).closest('li') as HTMLElement;
  await userEvent.click(within(phone).getByRole('button', { name: /sign out/i }));
  await waitFor(() => expect(revoked).toEqual(['s_phone']));
  await waitFor(() => expect(screen.queryByText('Safari on iPhone')).not.toBeInTheDocument());
});

test('signs out everywhere else, which needs another device', async () => {
  renderWithClient(<SessionsPanel />);
  const all = await screen.findByRole('button', { name: 'Sign out everywhere else' });
  expect(all).toBeEnabled();
  await userEvent.click(all);
  await waitFor(() => expect(revokedOthers).toBe(1));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Sign out everywhere else' })).toBeDisabled(),
  );
});

test('a failed load says what to do', async () => {
  server.use(http.get('/api/auth/sessions', () => new HttpResponse(null, { status: 500 })));
  renderWithClient(<SessionsPanel />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i);
});
