import type { InvitePublic } from '@neotext/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test } from 'vitest';
import { server } from '../../test/msw';
import { renderWithClient } from '../../test/renderWithClient';
import { InvitesPage } from './InvitesPage';

const DAY = 86_400_000;
const NOW = Date.now();
let invites: InvitePublic[];
let created: unknown[];
let revoked: string[];

beforeEach(() => {
  invites = [
    {
      id: 'inv_used',
      role: 'member',
      expiresAt: NOW + DAY,
      usedBy: 'u2',
      usedByUsername: 'ben',
      usedAt: NOW,
      createdAt: NOW - DAY,
    },
    {
      id: 'inv_open',
      role: 'admin',
      expiresAt: NOW + 7 * DAY,
      usedBy: null,
      usedByUsername: null,
      usedAt: null,
      createdAt: NOW,
    },
  ];
  created = [];
  revoked = [];
  server.use(
    http.get('/api/admin/invites', () => HttpResponse.json({ invites })),
    http.post('/api/admin/invites', async ({ request }) => {
      created.push(await request.json());
      const invite: InvitePublic = {
        id: 'inv_new',
        role: 'member',
        expiresAt: NOW + 30 * DAY,
        usedBy: null,
        usedByUsername: null,
        usedAt: null,
        createdAt: NOW,
      };
      invites = [invite, ...invites];
      return HttpResponse.json({ invite, code: 'NTXI-AAAA-BBBB-CCCC' }, { status: 201 });
    }),
    http.delete('/api/admin/invites/:id', ({ params }) => {
      revoked.push(String(params.id));
      invites = invites.filter((i) => i.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  );
});

test('lists invites with who used them, and revokes unused ones', async () => {
  const { user } = renderWithClient(<InvitesPage />);
  const table = await screen.findByRole('table');
  expect(within(table).getByText('Used by ben')).toBeInTheDocument();
  expect(within(table).getByText('Not used yet')).toBeInTheDocument();
  const revokeButtons = within(table).getAllByRole('button', { name: /^Revoke the/ });
  expect(revokeButtons).toHaveLength(1);
  await user.click(revokeButtons[0] as HTMLElement);
  await waitFor(() => expect(revoked).toEqual(['inv_open']));
});

test('a new code is shown once, with Copy', async () => {
  const { user } = renderWithClient(<InvitesPage />);
  await screen.findByRole('table');
  await user.click(screen.getByRole('combobox', { name: 'Expires after' }));
  await user.click(await screen.findByRole('option', { name: '30 days' }));
  await user.click(screen.getByRole('button', { name: 'Create invite' }));
  expect(await screen.findByText('NTXI-AAAA-BBBB-CCCC')).toBeInTheDocument();
  expect(created).toEqual([{ role: 'member', expiresInDays: 30 }]);
  expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.queryByText('NTXI-AAAA-BBBB-CCCC')).not.toBeInTheDocument();
});
