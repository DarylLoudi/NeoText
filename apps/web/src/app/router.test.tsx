import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test, vi } from 'vitest';
import { createQueryClient, qk } from '../lib/query';
import { flushSettings, hydrateSettings, teardownSettings } from '../state/settings';
import { server } from '../test/msw';
import { mockBackend, renderApp } from '../test/renderApp';
import { beginSession, endSession, resetSessionFlowForTests } from './session-flow';

vi.mock('../state/settings', () => import('../test/fake-settings'));

beforeEach(() => {
  resetSessionFlowForTests();
  vi.mocked(hydrateSettings).mockClear();
  vi.mocked(teardownSettings).mockClear();
});

test('setup required sends every route to /setup', async () => {
  mockBackend({ setupRequired: true });
  const { router } = renderApp('/c/abc');
  await waitFor(() => expect(router.state.location.pathname).toBe('/setup'));
  expect(await screen.findByText('How will you use NeoText?')).toBeInTheDocument();
});

test('signed out goes to /login and keeps the way back', async () => {
  mockBackend();
  const { router } = renderApp('/c/abc');
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  expect(router.state.location.search).toMatchObject({ redirect: '/c/abc' });
  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
});

test('signed in on an auth route goes to /', async () => {
  mockBackend({ signedIn: true });
  const { router } = renderApp('/login');
  await waitFor(() => expect(router.state.location.pathname).toBe('/'));
});

test('/setup is closed once setup is done', async () => {
  mockBackend({ signedIn: false });
  const { router } = renderApp('/setup');
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
});

test('a signed-in session hydrates settings on boot', async () => {
  mockBackend({ signedIn: true });
  renderApp('/');
  await waitFor(() => expect(hydrateSettings).toHaveBeenCalledWith('u1'));
});

test('a conversation route exists', async () => {
  mockBackend({ signedIn: true });
  const { router } = renderApp('/c/abc');
  await waitFor(() => expect(router.state.matches.at(-1)?.routeId).toBe('/c/$conversationId'));
});

test('/settings opens the general section', async () => {
  mockBackend({ signedIn: true });
  const { router } = renderApp('/settings');
  await waitFor(() => expect(router.state.location.pathname).toBe('/settings/general'));
  // The section code loads on demand, so the match settles a moment after the path does.
  await waitFor(() =>
    expect(router.state.matches.at(-1)?.params).toMatchObject({ section: 'general' }),
  );
});

test('a 401 mid-session sends the user to /login without discarding edits', async () => {
  mockBackend({ signedIn: true });
  const { router } = renderApp('/c/abc');
  await waitFor(() => expect(router.state.location.pathname).toBe('/c/abc'));
  server.use(
    http.get('/api/folders', () =>
      HttpResponse.json({ error: { code: 'unauthorized', message: 'Sign in.' } }, { status: 401 }),
    ),
  );
  await import('../lib/api/folders').then((m) => m.foldersApi.list().catch(() => {}));
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  expect(router.state.location.search).toMatchObject({ redirect: '/c/abc' });
  expect(teardownSettings).not.toHaveBeenCalled();
});

test('sign-out saves edits, logs out, then clears local state', async () => {
  const order: string[] = [];
  vi.mocked(flushSettings).mockImplementationOnce(async () => {
    order.push('flush');
  });
  vi.mocked(teardownSettings).mockImplementationOnce(async () => {
    order.push('teardown');
  });
  server.use(
    http.post('/api/auth/logout', () => {
      order.push('logout');
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const client = createQueryClient();
  client.setQueryData(['conversations'], [1]);
  await endSession(client);
  expect(order).toEqual(['flush', 'logout', 'teardown']);
  expect(client.getQueryData(['conversations'])).toBeUndefined();
  expect(client.getQueryData(qk.session)).toBeNull();
});

test('sign-out does not wait forever for a stuck save', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(flushSettings).mockImplementationOnce(() => new Promise(() => {}));
    server.use(http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })));
    const done = endSession(createQueryClient());
    await vi.advanceTimersByTimeAsync(3100);
    await done;
    expect(teardownSettings).toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test('sign-out clears the cache even when local teardown fails', async () => {
  vi.mocked(teardownSettings).mockRejectedValueOnce(new Error('storage locked'));
  server.use(http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })));
  const client = createQueryClient();
  client.setQueryData(['conversations'], [1]);
  await expect(endSession(client)).rejects.toThrow('storage locked');
  expect(client.getQueryData(['conversations'])).toBeUndefined();
  expect(client.getQueryData(qk.session)).toBeNull();
});

test('a different user signing in clears the previous user cache first', () => {
  const client = createQueryClient();
  const other = { id: 'u2', username: 'bob', displayName: 'Bob', role: 'member' as const };
  beginSession({ ...other, id: 'u1' }, client);
  client.setQueryData(['conversations'], [1]);
  beginSession({ ...other, id: 'u1' }, client);
  expect(client.getQueryData(['conversations'])).toEqual([1]);
  beginSession(other, client);
  expect(client.getQueryData(['conversations'])).toBeUndefined();
  expect(hydrateSettings).toHaveBeenLastCalledWith('u2');
});
