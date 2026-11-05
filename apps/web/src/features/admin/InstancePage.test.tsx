import type { AdminInstance } from '@neotext/shared';
import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test } from 'vitest';
import { server } from '../../test/msw';
import { renderWithClient } from '../../test/renderWithClient';
import { InstancePage } from './InstancePage';

let current: AdminInstance;
let patches: unknown[];

beforeEach(() => {
  current = { mode: 'community', registration: 'invite', escrow: false, defaultQuota: null };
  patches = [];
  server.use(
    http.get('/api/admin/instance', () => HttpResponse.json(current)),
    http.patch('/api/admin/instance', async ({ request }) => {
      const body = (await request.json()) as Partial<AdminInstance>;
      patches.push(body);
      current = { ...current, ...body };
      return HttpResponse.json(current);
    }),
  );
});

test('instance page explains escrow', async () => {
  const { user } = renderWithClient(<InstancePage />);
  const escrow = await screen.findByRole('switch', { name: 'Password escrow' });
  expect(
    screen.getByText(
      "On: admins can reset passwords, and could read chats by using the server key. Off: only the password or recovery key opens a user's chats.",
    ),
  ).toBeInTheDocument();
  expect(escrow).not.toBeChecked();
  await user.click(escrow);
  await waitFor(() => expect(patches).toEqual([{ escrow: true }]));
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: 'Password escrow' })).toBeChecked(),
  );
});

test('mode and registration are saved as they change', async () => {
  const { user } = renderWithClient(<InstancePage />);
  await user.click(await screen.findByRole('combobox', { name: 'Sign-ups' }));
  await user.click(await screen.findByRole('option', { name: 'Open' }));
  await waitFor(() => expect(patches).toEqual([{ registration: 'open' }]));
});

test('a personal instance shows sign-ups as closed and locked', async () => {
  server.use(
    http.patch('/api/admin/instance', async ({ request }) => {
      const body = (await request.json()) as Partial<AdminInstance>;
      patches.push(body);
      // The server closes sign-ups with personal mode.
      current = { ...current, ...body, registration: 'closed' };
      return HttpResponse.json(current);
    }),
  );
  const { user } = renderWithClient(<InstancePage />);
  expect(await screen.findByRole('combobox', { name: 'Sign-ups' })).toBeEnabled();
  await user.click(screen.getByRole('combobox', { name: 'Mode' }));
  await user.click(await screen.findByRole('option', { name: 'Personal' }));
  await waitFor(() => expect(patches).toEqual([{ mode: 'personal' }]));
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Sign-ups' })).toBeDisabled());
  expect(screen.getByRole('combobox', { name: 'Sign-ups' })).toHaveTextContent('Closed');
  expect(
    screen.getByText(
      'A personal NeoText takes no sign-ups. Switch to community mode to open them.',
    ),
  ).toBeInTheDocument();
});

test('refusing sign-ups on a personal instance is worded for the admin', async () => {
  current = { mode: 'personal', registration: 'closed', escrow: false, defaultQuota: null };
  server.use(
    http.patch('/api/admin/instance', () =>
      HttpResponse.json(
        {
          error: {
            code: 'conflict',
            message: 'server words',
            details: { reason: 'personal_signups' },
          },
        },
        { status: 409 },
      ),
    ),
  );
  const { user } = renderWithClient(<InstancePage />);
  await user.click(await screen.findByRole('switch', { name: 'Password escrow' }));
  // Any save the server refuses this way (another tab may have opened sign-ups) gets our words.
  await waitFor(() => expect(screen.getAllByText(/takes no sign-ups/).length).toBeGreaterThan(1));
});

test('the default shared budget is saved from its boxes', async () => {
  const { user } = renderWithClient(<InstancePage />);
  const monthly = await screen.findByRole('spinbutton', { name: 'Monthly limit (USD)' });
  await user.type(monthly, '12');
  await user.tab();
  await waitFor(() =>
    expect(patches).toEqual([{ defaultQuota: { dailyUsd: null, monthlyUsd: 12 } }]),
  );
});
