import { screen, waitFor } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test, vi } from 'vitest';
import { hydrateSettings } from '../../state/settings';
import { server } from '../../test/msw';
import { mockBackend, renderApp, testUser } from '../../test/renderApp';

vi.mock('../../state/settings', () => import('../../test/fake-settings'));

beforeEach(() => {
  vi.mocked(hydrateSettings).mockClear();
  mockBackend();
});

async function fill(user: UserEvent, repeat = 'a new password') {
  await user.type(await screen.findByLabelText('Username'), 'ada');
  await user.type(screen.getByLabelText('Recovery key'), 'NTXR-OLD0');
  await user.type(screen.getByLabelText('New password'), 'a new password');
  await user.type(screen.getByLabelText('Repeat password'), repeat);
}

test('recover shows the new key with the same gate', async () => {
  let body: unknown;
  server.use(
    http.post('/api/auth/recover', async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ user: testUser, recoveryKey: 'NTXR-NEW1' });
    }),
  );
  const { user, router } = renderApp('/recover');
  await fill(user);
  await user.click(screen.getByRole('button', { name: 'Reset password' }));
  expect(await screen.findByText('NTXR-NEW1')).toBeInTheDocument();
  expect(body).toEqual({
    username: 'ada',
    recoveryKey: 'NTXR-OLD0',
    newPassword: 'a new password',
  });
  expect(hydrateSettings).toHaveBeenCalledWith('u1');
  const next = screen.getByRole('button', { name: 'Continue' });
  expect(next).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: 'I saved my recovery key' }));
  await user.click(next);
  await waitFor(() => expect(router.state.location.pathname).toBe('/'));
});

test('mismatched new passwords are not sent', async () => {
  let posted = false;
  server.use(
    http.post('/api/auth/recover', () => {
      posted = true;
      return HttpResponse.json({ user: testUser, recoveryKey: 'x' });
    }),
  );
  const { user } = renderApp('/recover');
  await fill(user, 'different');
  await user.click(screen.getByRole('button', { name: 'Reset password' }));
  expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
  expect(posted).toBe(false);
});

test('a wrong key shows the server message', async () => {
  server.use(
    http.post('/api/auth/recover', () =>
      HttpResponse.json(
        {
          error: {
            code: 'invalid_recovery_key',
            message: "That recovery key doesn't match this account.",
          },
        },
        { status: 400 },
      ),
    ),
  );
  const { user } = renderApp('/recover');
  await fill(user);
  await user.click(screen.getByRole('button', { name: 'Reset password' }));
  expect(await screen.findByRole('alert')).toHaveTextContent("That recovery key doesn't match");
});

test('focus moves to the new key heading, and to the first invalid field on error', async () => {
  server.use(
    http.post('/api/auth/recover', () =>
      HttpResponse.json({ user: testUser, recoveryKey: 'NTXR-NEW1' }),
    ),
  );
  const { user } = renderApp('/recover');
  expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Reset your password');
  await fill(user, 'different');
  await user.click(screen.getByRole('button', { name: 'Reset password' }));
  await screen.findByText(/passwords do not match/i);
  expect(screen.getByLabelText('Repeat password')).toHaveFocus();
  await user.clear(screen.getByLabelText('Repeat password'));
  await user.type(screen.getByLabelText('Repeat password'), 'a new password');
  await user.click(screen.getByRole('button', { name: 'Reset password' }));
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Save your new recovery key' }),
  ).toHaveFocus();
});
