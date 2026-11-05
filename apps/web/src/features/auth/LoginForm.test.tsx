import { screen, waitFor } from '@testing-library/react';
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

test('login shows the server message', async () => {
  server.use(
    http.post('/api/auth/login', () =>
      HttpResponse.json(
        { error: { code: 'invalid_credentials', message: 'Username or password is incorrect.' } },
        { status: 401 },
      ),
    ),
  );
  const { user } = renderApp('/login');
  await user.type(await screen.findByLabelText('Username'), 'ada');
  await user.type(screen.getByLabelText('Password'), 'nope');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Username or password is incorrect.');
});

test('signing in hydrates settings and opens the app', async () => {
  let body: unknown;
  server.use(
    http.post('/api/auth/login', async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ user: testUser });
    }),
  );
  const { user, router } = renderApp('/login');
  await user.type(await screen.findByLabelText('Username'), 'ada');
  await user.type(screen.getByLabelText('Password'), 'correct horse');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  expect(body).toEqual({ username: 'ada', password: 'correct horse' });
  expect(hydrateSettings).toHaveBeenCalledWith('u1');
});

test('signing in returns to the page that was asked for', async () => {
  server.use(http.post('/api/auth/login', () => HttpResponse.json({ user: testUser })));
  const { user, router } = renderApp('/c/abc');
  await user.type(await screen.findByLabelText('Username'), 'ada');
  await user.type(screen.getByLabelText('Password'), 'correct horse');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/c/abc'));
});

test('the forgot link goes to recovery', async () => {
  const { user, router } = renderApp('/login');
  await user.click(await screen.findByRole('link', { name: 'Forgot your password?' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/recover'));
});

test('a failed sign-in moves focus to the message', async () => {
  server.use(
    http.post('/api/auth/login', () =>
      HttpResponse.json(
        { error: { code: 'invalid_credentials', message: 'Username or password is incorrect.' } },
        { status: 401 },
      ),
    ),
  );
  const { user } = renderApp('/login');
  expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
  await user.type(screen.getByLabelText('Username'), 'ada');
  await user.type(screen.getByLabelText('Password'), 'nope');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toHaveFocus();
});
