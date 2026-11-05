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
  mockBackend({ setupRequired: true, envProviderAvailable: true });
});

async function fillAccount(user: UserEvent, repeat = 'correct horse') {
  await user.type(await screen.findByLabelText('Username'), 'ada');
  await user.type(screen.getByLabelText('Password'), 'correct horse');
  await user.type(screen.getByLabelText('Repeat password'), repeat);
}

async function toAccountStep(user: UserEvent) {
  await user.click(await screen.findByRole('button', { name: 'Next' }));
}

const provider = {
  id: 'p1',
  category: 'llm',
  kind: 'openrouter',
  name: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  hasKey: true,
  keyHint: 'test',
  enabled: true,
  shared: false,
  manualModels: [],
  createdAt: 1,
  updatedAt: 1,
};

function mockSetup(onBody?: (body: unknown) => void) {
  server.use(
    http.post('/api/setup', async ({ request }) => {
      onBody?.(await request.json());
      return HttpResponse.json({ user: testUser, recoveryKey: 'NTXR-AAAA' }, { status: 201 });
    }),
  );
}

async function throughRecoveryKey(user: UserEvent) {
  await toAccountStep(user);
  await fillAccount(user);
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await user.click(await screen.findByRole('checkbox', { name: 'I saved my recovery key' }));
  await user.click(screen.getByRole('button', { name: 'Continue' }));
}

test('recovery key must be acknowledged', async () => {
  mockSetup();
  const { user } = renderApp('/setup');
  await toAccountStep(user);
  await fillAccount(user);
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByText('NTXR-AAAA')).toBeInTheDocument();
  const next = screen.getByRole('button', { name: 'Continue' });
  expect(next).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: 'I saved my recovery key' }));
  expect(next).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  expect(screen.getByText(/NeoText cannot reset it for you/)).toBeInTheDocument();
});

test('passwords must match before anything is sent', async () => {
  let posted = false;
  mockSetup(() => {
    posted = true;
  });
  const { user } = renderApp('/setup');
  await toAccountStep(user);
  await fillAccount(user, 'something else');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
  expect(posted).toBe(false);
});

test('setup sends mode and env-provider choice', async () => {
  let body: unknown;
  mockSetup((b) => {
    body = b;
  });
  const { user } = renderApp('/setup');
  await toAccountStep(user);
  await fillAccount(user);
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await screen.findByText('NTXR-AAAA');
  expect(body).toEqual({
    username: 'ada',
    password: 'correct horse',
    mode: 'personal',
    useEnvProvider: true,
  });
  expect(hydrateSettings).toHaveBeenCalledWith('u1');
});

test('a group, a display name and no server key are sent as chosen', async () => {
  let body: unknown;
  mockSetup((b) => {
    body = b;
  });
  const { user } = renderApp('/setup');
  await user.click(await screen.findByRole('radio', { name: 'For a group' }));
  await toAccountStep(user);
  await fillAccount(user);
  await user.type(screen.getByLabelText('Display name'), 'Ada L');
  await user.click(screen.getByRole('switch', { name: 'Use the OpenRouter key from this server' }));
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await screen.findByText('NTXR-AAAA');
  expect(body).toEqual({
    username: 'ada',
    password: 'correct horse',
    displayName: 'Ada L',
    mode: 'community',
    useEnvProvider: false,
  });
});

test('field errors land on their field', async () => {
  server.use(
    http.post('/api/setup', () =>
      HttpResponse.json(
        {
          error: {
            code: 'validation_failed',
            message: 'Invalid input.',
            details: [{ path: ['password'], message: 'Use at least 12 characters.' }],
          },
        },
        { status: 400 },
      ),
    ),
  );
  const { user } = renderApp('/setup');
  await toAccountStep(user);
  await fillAccount(user);
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await screen.findByText('Use at least 12 characters.');
  expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(
    'Use at least 12 characters.',
  );
  expect(screen.getByLabelText('Password')).toBeInvalid();
});

test('a server message without a field shows under the form', async () => {
  server.use(
    http.post('/api/setup', () =>
      HttpResponse.json(
        { error: { code: 'validation_failed', message: 'That username is not allowed.' } },
        { status: 400 },
      ),
    ),
  );
  const { user } = renderApp('/setup');
  await toAccountStep(user);
  await fillAccount(user);
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('That username is not allowed.');
});

test('with no provider yet, offers to connect one and sends the key', async () => {
  mockBackend({ setupRequired: true, envProviderAvailable: false });
  mockSetup();
  let created: unknown;
  server.use(
    http.get('/api/providers', () => HttpResponse.json({ providers: [] })),
    http.post('/api/providers', async ({ request }) => {
      created = await request.json();
      return HttpResponse.json({ provider: provider }, { status: 201 });
    }),
  );
  const { user, router } = renderApp('/setup');
  await toAccountStep(user);
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  await fillAccount(user);
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await user.click(await screen.findByRole('checkbox', { name: 'I saved my recovery key' }));
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByText('Connect a model provider')).toBeInTheDocument();
  await user.type(screen.getByLabelText('OpenRouter key'), 'sk-or-test');
  await user.click(screen.getByRole('button', { name: 'Connect' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  expect(created).toEqual({ kind: 'openrouter', name: 'OpenRouter', apiKey: 'sk-or-test' });
});

test('skipping the provider step goes to the app', async () => {
  mockBackend({ setupRequired: true, envProviderAvailable: false });
  mockSetup();
  server.use(http.get('/api/providers', () => HttpResponse.json({ providers: [] })));
  const { user, router } = renderApp('/setup');
  await throughRecoveryKey(user);
  await user.click(await screen.findByRole('button', { name: 'Skip for now' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/'));
});

test('when a provider already exists the wizard finishes after the key', async () => {
  mockSetup();
  server.use(http.get('/api/providers', () => HttpResponse.json({ providers: [provider] })));
  const { user, router } = renderApp('/setup');
  await throughRecoveryKey(user);
  await waitFor(() => expect(router.state.location.pathname).toBe('/'));
});

test('every screen has an h1 and focus follows each step change', async () => {
  mockSetup();
  const { user } = renderApp('/setup');
  expect(
    await screen.findByRole('heading', { level: 1, name: 'How will you use NeoText?' }),
  ).toBeInTheDocument();
  await toAccountStep(user);
  expect(screen.getByRole('heading', { level: 1, name: 'Create your account' })).toHaveFocus();
  await fillAccount(user);
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Save your recovery key' }),
  ).toHaveFocus();
});

test('after a failed submit focus goes to the first invalid field, or to the alert', async () => {
  mockSetup();
  const { user } = renderApp('/setup');
  await toAccountStep(user);
  await fillAccount(user, 'something else');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await screen.findByText(/passwords do not match/i);
  expect(screen.getByLabelText('Repeat password')).toHaveFocus();

  server.use(
    http.post('/api/setup', () =>
      HttpResponse.json(
        { error: { code: 'validation_failed', message: 'That username is not allowed.' } },
        { status: 400 },
      ),
    ),
  );
  await user.clear(screen.getByLabelText('Repeat password'));
  await user.type(screen.getByLabelText('Repeat password'), 'correct horse');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByRole('alert')).toHaveFocus();
});

test('a refresh is guarded while the recovery key is unconfirmed', async () => {
  mockSetup();
  const { user } = renderApp('/setup');
  await toAccountStep(user);
  await fillAccount(user);
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await screen.findByText('NTXR-AAAA');
  const blocked = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(blocked);
  expect(blocked.defaultPrevented).toBe(true);
  await user.click(screen.getByRole('checkbox', { name: 'I saved my recovery key' }));
  const free = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(free);
  expect(free.defaultPrevented).toBe(false);
});
