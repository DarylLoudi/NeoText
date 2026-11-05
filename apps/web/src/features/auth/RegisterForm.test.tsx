import { screen, waitFor } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test, vi } from 'vitest';
import { hydrateSettings } from '../../state/settings';
import { server } from '../../test/msw';
import { mockBackend, renderApp, testUser } from '../../test/renderApp';

vi.mock('../../state/settings', () => import('../../test/fake-settings'));

function mockRegistration(registration: 'closed' | 'invite' | 'open', escrow = false) {
  mockBackend();
  server.use(
    http.get('/api/instance', () =>
      HttpResponse.json({
        setupRequired: false,
        mode: 'community',
        registration,
        version: '0.1.0',
        envProviderAvailable: false,
        escrow,
      }),
    ),
  );
}

beforeEach(() => {
  vi.mocked(hydrateSettings).mockClear();
  mockRegistration('invite');
});

async function fillForm(user: UserEvent, code?: string) {
  await user.type(await screen.findByLabelText('Username'), 'newbie');
  await user.type(screen.getByLabelText('Password'), 'correct horse');
  await user.type(screen.getByLabelText('Repeat password'), 'correct horse');
  if (code) await user.type(screen.getByLabelText('Invite code'), code);
}

test('asks for a code only when invites are required', async () => {
  renderApp('/register');
  expect(await screen.findByLabelText('Invite code')).toBeInTheDocument();
});

test('does not ask for a code when sign-up is open', async () => {
  mockRegistration('open');
  renderApp('/register');
  expect(await screen.findByLabelText('Username')).toBeInTheDocument();
  expect(screen.queryByLabelText('Invite code')).not.toBeInTheDocument();
});

test('sends the code with the account and shows the recovery key gate', async () => {
  let body: unknown;
  server.use(
    http.post('/api/auth/register', async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ user: testUser, recoveryKey: 'NTXR-BBBB' }, { status: 201 });
    }),
  );
  const { user, router } = renderApp('/register');
  await fillForm(user, 'NTXI-0000-1111-2222');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByText('NTXR-BBBB')).toBeInTheDocument();
  expect(body).toEqual({
    username: 'newbie',
    password: 'correct horse',
    inviteCode: 'NTXI-0000-1111-2222',
  });
  expect(hydrateSettings).toHaveBeenCalledWith('u1');
  const next = screen.getByRole('button', { name: 'Continue' });
  expect(next).toBeDisabled();
  expect(router.state.location.pathname).toBe('/register');
  await user.click(screen.getByRole('checkbox', { name: 'I saved my recovery key' }));
  await user.click(next);
  await waitFor(() => expect(router.state.location.pathname).toBe('/'));
});

test('open sign-up sends no code', async () => {
  mockRegistration('open');
  let body: unknown;
  server.use(
    http.post('/api/auth/register', async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ user: testUser, recoveryKey: 'NTXR-BBBB' }, { status: 201 });
    }),
  );
  const { user } = renderApp('/register');
  await fillForm(user);
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await screen.findByText('NTXR-BBBB');
  expect(body).toEqual({ username: 'newbie', password: 'correct horse' });
});

test('passwords must match before anything is sent', async () => {
  let posted = false;
  server.use(
    http.post('/api/auth/register', () => {
      posted = true;
      return HttpResponse.json({}, { status: 500 });
    }),
  );
  const { user } = renderApp('/register');
  await user.type(await screen.findByLabelText('Username'), 'newbie');
  await user.type(screen.getByLabelText('Password'), 'correct horse');
  await user.type(screen.getByLabelText('Repeat password'), 'different');
  await user.type(screen.getByLabelText('Invite code'), 'NTXI-0000-1111-2222');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
  expect(posted).toBe(false);
});

test('a bad code and a taken username are worded in the page language', async () => {
  const refuse = (status: number, code: string, reason: string) =>
    server.use(
      http.post('/api/auth/register', () =>
        HttpResponse.json(
          { error: { code, message: 'server words', details: { reason } } },
          { status },
        ),
      ),
    );
  refuse(403, 'forbidden', 'invite_invalid');
  const { user } = renderApp('/register');
  await fillForm(user, 'NTXI-0000-1111-2222');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Invite code')).toHaveAccessibleDescription(
      'That invite code did not work. Check it, or ask for a new one.',
    ),
  );
  refuse(409, 'conflict', 'username_taken');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Username')).toHaveAccessibleDescription(
      'That username is taken. Pick another one.',
    ),
  );
});

test('login offers to create an account when sign-up is not closed', async () => {
  const { user, router } = renderApp('/login');
  await user.click(await screen.findByRole('link', { name: 'Create an account' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/register'));
});

test('login hides the link when sign-up is closed, and /register goes back to sign in', async () => {
  mockRegistration('closed');
  const { router } = renderApp('/login');
  expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Create an account' })).not.toBeInTheDocument();
  await router.navigate({ to: '/register' });
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
});

test('a server check on a field is shown on that field', async () => {
  server.use(
    http.post('/api/auth/register', () =>
      HttpResponse.json(
        {
          error: {
            code: 'validation_failed',
            message: 'Use 3–32 letters, digits, dots, dashes or underscores.',
            details: [
              {
                path: ['username'],
                message: 'Use 3–32 letters, digits, dots, dashes or underscores.',
              },
            ],
          },
        },
        { status: 400 },
      ),
    ),
  );
  const { user } = renderApp('/register');
  await fillForm(user, 'NTXI-0000-1111-2222');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Username')).toHaveAccessibleDescription(
      'Use 3–32 letters, digits, dots, dashes or underscores.',
    ),
  );
});

test('says when the admin can reset passwords', async () => {
  mockRegistration('invite', true);
  renderApp('/register');
  expect(
    await screen.findByText('The admin of this NeoText can reset your password.'),
  ).toBeInTheDocument();
});

test('says nothing about resets when escrow is off', async () => {
  renderApp('/register');
  await screen.findByLabelText('Username');
  expect(screen.queryByText(/can reset your password/)).not.toBeInTheDocument();
});
