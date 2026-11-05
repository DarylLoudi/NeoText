import type { AdminUser } from '@neotext/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test } from 'vitest';
import { server } from '../../test/msw';
import { renderWithClient } from '../../test/renderWithClient';
import { UsersPage } from './UsersPage';

const NOW = Date.now();
const users: AdminUser[] = [
  {
    id: 'u1',
    username: 'ada',
    displayName: 'Ada',
    role: 'admin',
    status: 'active',
    createdAt: NOW,
    lastSeenAt: NOW,
    monthCostUsd: 1.5,
  },
  {
    id: 'u2',
    username: 'ben',
    displayName: 'Ben',
    role: 'member',
    status: 'active',
    createdAt: NOW,
    lastSeenAt: null,
    monthCostUsd: 0,
  },
];

let patches: { id: string; body: unknown }[];
let resets: string[];
let meCalls: number;
let me: { id: string; username: string; displayName: string; role: 'admin' | 'member' };

function mockInstance(escrow: boolean) {
  server.use(
    http.get('/api/instance', () =>
      HttpResponse.json({
        setupRequired: false,
        mode: 'community',
        registration: 'invite',
        version: '0.1.0',
        envProviderAvailable: false,
        escrow,
      }),
    ),
  );
}

beforeEach(() => {
  patches = [];
  resets = [];
  meCalls = 0;
  me = { id: 'u1', username: 'ada', displayName: 'Ada', role: 'admin' };
  mockInstance(true);
  server.use(
    http.get('/api/auth/me', () => {
      meCalls += 1;
      return HttpResponse.json({ user: me });
    }),
    http.get('/api/admin/users', () => HttpResponse.json({ users })),
    http.patch('/api/admin/users/:id', async ({ params, request }) => {
      const body = (await request.json()) as Partial<AdminUser>;
      patches.push({ id: String(params.id), body });
      const user = users.find((u) => u.id === params.id);
      return HttpResponse.json({ user: { ...user, ...body } });
    }),
    http.post('/api/admin/users/:id/reset-password', ({ params }) => {
      resets.push(String(params.id));
      return HttpResponse.json({ temporaryPassword: 'K7Q2M9XR4TZW8HPN' });
    }),
  );
});

test('users page lists people and its actions call the API', async () => {
  const { user } = renderWithClient(<UsersPage />);
  const table = await screen.findByRole('table');
  const ben = within(table).getByRole('row', { name: /Ben/ });
  expect(within(ben).getByText('Member')).toBeInTheDocument();
  expect(within(ben).getByText('Not signed in yet')).toBeInTheDocument();
  expect(within(within(table).getByRole('row', { name: /Ada/ })).getByText('$1.50')).toBeVisible();

  await user.click(screen.getByRole('button', { name: 'Options for Ben' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Make admin' }));
  await waitFor(() => expect(patches).toEqual([{ id: 'u2', body: { role: 'admin' } }]));

  await user.click(screen.getByRole('button', { name: 'Options for Ben' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Disable' }));
  await waitFor(() => expect(patches[1]).toEqual({ id: 'u2', body: { status: 'disabled' } }));
});

test('the last admin refusal is worded for the admin', async () => {
  server.use(
    http.patch('/api/admin/users/:id', () =>
      HttpResponse.json(
        {
          error: {
            code: 'conflict',
            message: 'NeoText needs at least one active admin.',
            details: { reason: 'last_admin' },
          },
        },
        { status: 409 },
      ),
    ),
  );
  const { user } = renderWithClient(<UsersPage />);
  await user.click(await screen.findByRole('button', { name: 'Options for Ada' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Make member' }));
  expect(
    await screen.findByText(
      'NeoText needs at least one active admin. Make someone else an admin first.',
    ),
  ).toBeInTheDocument();
});

test('temporary password is shown once', async () => {
  const { user, queryClient } = renderWithClient(<UsersPage />);
  await user.click(await screen.findByRole('button', { name: 'Options for Ben' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Reset password' }));
  const dialog = await screen.findByRole('dialog', { name: 'Reset password for Ben?' });
  await user.click(within(dialog).getByRole('button', { name: 'Reset password' }));
  expect(await screen.findByText('K7Q2M9XR4TZW8HPN')).toBeInTheDocument();
  expect(resets).toEqual(['u2']);
  await user.click(screen.getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(screen.queryByText('K7Q2M9XR4TZW8HPN')).not.toBeInTheDocument());
  // Nor does it linger in the mutation cache.
  const cached = () =>
    JSON.stringify(
      queryClient
        .getMutationCache()
        .getAll()
        .map((m) => m.state.data),
    );
  await waitFor(() => expect(cached()).not.toContain('K7Q2M9XR4TZW8HPN'));

  // Opening it again starts over: the old password is gone for good.
  await user.click(screen.getByRole('button', { name: 'Options for Ben' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Reset password' }));
  expect(await screen.findByRole('dialog', { name: 'Reset password for Ben?' })).toBeVisible();
  expect(screen.queryByText('K7Q2M9XR4TZW8HPN')).not.toBeInTheDocument();
});

test('without escrow, reset explains why it is not offered', async () => {
  mockInstance(false);
  const { user } = renderWithClient(<UsersPage />);
  await user.click(await screen.findByRole('button', { name: 'Options for Ben' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Reset password' }));
  const dialog = await screen.findByRole('dialog', { name: 'Reset password for Ben?' });
  expect(
    within(dialog).getByText(/Password escrow is off, so this account can't be reset/),
  ).toBeInTheDocument();
  expect(within(dialog).queryByRole('button', { name: 'Reset password' })).toBeNull();
  expect(resets).toEqual([]);
});

test('a user who has not signed in since escrow was turned on gets the same explanation', async () => {
  server.use(
    http.post('/api/admin/users/:id/reset-password', () =>
      HttpResponse.json(
        {
          error: {
            code: 'conflict',
            message: "This account can't be reset without losing its chats.",
            details: { reason: 'no_escrow' },
          },
        },
        { status: 409 },
      ),
    ),
  );
  const { user } = renderWithClient(<UsersPage />);
  await user.click(await screen.findByRole('button', { name: 'Options for Ben' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Reset password' }));
  const dialog = await screen.findByRole('dialog', { name: 'Reset password for Ben?' });
  await user.click(within(dialog).getByRole('button', { name: 'Reset password' }));
  expect(
    await within(dialog).findByText(
      "Ben hasn't signed in since password escrow was turned on, so there is no key to reset with yet. Once they sign in, you can reset their password.",
    ),
  ).toBeInTheDocument();
  expect(within(dialog).queryByRole('button', { name: 'Reset password' })).toBeNull();
});

test('stepping down refreshes the session, so the admin view updates', async () => {
  const { user } = renderWithClient(<UsersPage />);
  await screen.findByRole('table');
  await waitFor(() => expect(meCalls).toBe(1));
  me = { ...me, role: 'member' };
  await user.click(screen.getByRole('button', { name: 'Options for Ada' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Make member' }));
  await waitFor(() => expect(patches).toEqual([{ id: 'u1', body: { role: 'member' } }]));
  await waitFor(() => expect(meCalls).toBe(2));
});

test('changing someone else does not refetch the session', async () => {
  const { user } = renderWithClient(<UsersPage />);
  await screen.findByRole('table');
  await waitFor(() => expect(meCalls).toBe(1));
  await user.click(screen.getByRole('button', { name: 'Options for Ben' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Make admin' }));
  await waitFor(() => expect(patches).toHaveLength(1));
  await screen.findByRole('table');
  expect(meCalls).toBe(1);
});

test('an admin sets and clears a member limit on shared models', async () => {
  let own: { dailyUsd: number | null; monthlyUsd: number | null } | null = null;
  const defaults = { dailyUsd: 1, monthlyUsd: null };
  const puts: unknown[] = [];
  const shape = () => ({ quota: own, effective: own ?? defaults });
  server.use(
    http.get('/api/admin/quotas/:id', () => HttpResponse.json(shape())),
    http.put('/api/admin/quotas/:id', async ({ request }) => {
      const body = (await request.json()) as { quota: typeof own };
      puts.push(body);
      own = body.quota;
      return HttpResponse.json(shape());
    }),
  );
  const { user } = renderWithClient(<UsersPage />);
  await user.click(await screen.findByRole('button', { name: 'Options for Ben' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Shared budget' }));
  const dialog = await screen.findByRole('dialog', { name: 'Shared budget for Ben' });
  expect(await within(dialog).findByText(/instance default applies/)).toBeInTheDocument();
  const daily = within(dialog).getByRole('spinbutton', { name: 'Daily limit (USD)' });
  expect(daily).toHaveValue(1);
  await user.clear(daily);
  await user.type(daily, '2.5');
  await user.tab();
  await waitFor(() => expect(puts).toEqual([{ quota: { dailyUsd: 2.5, monthlyUsd: null } }]));
  await user.click(await within(dialog).findByRole('button', { name: 'Use the instance default' }));
  await waitFor(() => expect(puts[1]).toEqual({ quota: null }));
});
