import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test, vi } from 'vitest';
import { setUnauthorizedHandler } from '../../../lib/api/client';
import { server } from '../../../test/msw';
import { renderWithClient } from '../../../test/renderWithClient';
import { SecuritySettings } from './SecuritySettings';

const KEY = 'NTXR-7K3Q-AAAA-BBBB-CCCC';
let passwordBodies: Record<string, string>[];
let rotateBodies: Record<string, string>[];
let rotateWrong = false;

const instanceInfo = (escrow: boolean) =>
  http.get('/api/instance', () =>
    HttpResponse.json({
      setupRequired: false,
      mode: 'community',
      registration: 'invite',
      version: '0.1.0',
      envProviderAvailable: false,
      escrow,
    }),
  );

beforeEach(() => {
  server.use(instanceInfo(false));
  passwordBodies = [];
  rotateBodies = [];
  rotateWrong = false;
  server.use(
    http.post('/api/auth/password', async ({ request }) => {
      passwordBodies.push((await request.json()) as Record<string, string>);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('/api/auth/recovery-key', async ({ request }) => {
      rotateBodies.push((await request.json()) as Record<string, string>);
      if (rotateWrong) {
        return HttpResponse.json(
          { error: { code: 'invalid_credentials', message: 'Username or password is incorrect.' } },
          { status: 401 },
        );
      }
      return HttpResponse.json({ recoveryKey: KEY });
    }),
  );
});

async function fillPassword(
  user: ReturnType<typeof renderWithClient>['user'],
  values: { current: string; next: string; repeat: string },
) {
  await user.type(screen.getByLabelText('Current password'), values.current);
  await user.type(screen.getByLabelText('New password'), values.next);
  await user.type(screen.getByLabelText('Repeat new password'), values.repeat);
}

test('changing the password sends both passwords and says what else happens', async () => {
  const { user } = renderWithClient(<SecuritySettings />);
  await fillPassword(user, {
    current: 'old-pass-123',
    next: 'new-pass-4567',
    repeat: 'new-pass-4567',
  });
  await user.click(screen.getByRole('button', { name: 'Change password' }));
  await waitFor(() =>
    expect(passwordBodies).toEqual([
      { currentPassword: 'old-pass-123', newPassword: 'new-pass-4567' },
    ]),
  );
  expect(await screen.findByText('Password changed')).toBeInTheDocument();
  expect(screen.getByLabelText('Current password')).toHaveValue('');
});

test('two different new passwords are caught before anything is sent', async () => {
  const { user } = renderWithClient(<SecuritySettings />);
  await fillPassword(user, {
    current: 'old-pass-123',
    next: 'new-pass-4567',
    repeat: 'other-4567',
  });
  await user.click(screen.getByRole('button', { name: 'Change password' }));
  expect(await screen.findByText(/The passwords do not match/)).toBeInTheDocument();
  expect(passwordBodies).toHaveLength(0);
});

test('a wrong current password stays on the page and does not sign you out', async () => {
  const lost = vi.fn();
  setUnauthorizedHandler(lost);
  server.use(
    http.post('/api/auth/password', () =>
      HttpResponse.json(
        { error: { code: 'invalid_credentials', message: 'Username or password is incorrect.' } },
        { status: 401 },
      ),
    ),
  );
  const { user } = renderWithClient(<SecuritySettings />);
  await fillPassword(user, { current: 'nope', next: 'new-pass-4567', repeat: 'new-pass-4567' });
  await user.click(screen.getByRole('button', { name: 'Change password' }));
  expect(await screen.findByText(/That password is not right/)).toBeInTheDocument();
  expect(lost).not.toHaveBeenCalled();
  setUnauthorizedHandler(() => {});
});

test('rotate recovery key requires the password and gates the new key', async () => {
  const { user } = renderWithClient(<SecuritySettings />);
  await user.click(screen.getByRole('button', { name: 'Make a new recovery key' }));
  const dialog = await screen.findByRole('dialog', { name: 'Make a new recovery key' });
  expect(screen.queryByText(KEY)).not.toBeInTheDocument();
  await user.type(within(dialog).getByLabelText('Your password'), 'old-pass-123');
  await user.click(within(dialog).getByRole('button', { name: 'Make new key' }));

  await waitFor(() => expect(rotateBodies).toEqual([{ password: 'old-pass-123' }]));
  expect(await screen.findByText(KEY)).toBeInTheDocument();
  const next = screen.getByRole('button', { name: 'Continue' });
  expect(next).toBeDisabled();
  await user.click(screen.getByRole('checkbox'));
  expect(next).toBeEnabled();
  await user.click(next);
  expect(screen.queryByText(KEY)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Make a new recovery key' })).toBeInTheDocument();
});

test('a wrong password for the new key is explained in the dialog', async () => {
  rotateWrong = true;
  const { user } = renderWithClient(<SecuritySettings />);
  await user.click(screen.getByRole('button', { name: 'Make a new recovery key' }));
  const dialog = await screen.findByRole('dialog', { name: 'Make a new recovery key' });
  await user.type(within(dialog).getByLabelText('Your password'), 'wrong');
  await user.click(within(dialog).getByRole('button', { name: 'Make new key' }));
  expect(await within(dialog).findByText(/That password is not right/)).toBeInTheDocument();
  expect(screen.queryByText(KEY)).not.toBeInTheDocument();
});

test('says what is encrypted and that the model provider can read prompts', () => {
  renderWithClient(<SecuritySettings />);
  expect(screen.getByText(/Your model provider can read what you send to it/)).toBeInTheDocument();
  const sealed = screen.getByRole('list', { name: 'Encrypted on the server' });
  expect(within(sealed).getByText('Messages and chat titles')).toBeInTheDocument();
  expect(within(sealed).getByText('Provider API keys and headers')).toBeInTheDocument();
  const visible = screen.getByRole('list', { name: 'Not encrypted' });
  expect(within(visible).getByText('Times, roles and token counts')).toBeInTheDocument();
});

test('with escrow on, says the admin can reset the password', async () => {
  server.use(instanceInfo(true));
  renderWithClient(<SecuritySettings />);
  expect(
    await screen.findByText('The admin of this NeoText can reset your password.'),
  ).toBeInTheDocument();
});
