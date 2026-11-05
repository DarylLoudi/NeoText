import { createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { App } from '../app/App';
import { createAppRouter } from '../app/router';
import { createQueryClient } from '../lib/query';
import { server } from './msw';

export const testUser = { id: 'u1', username: 'ada', displayName: 'Ada', role: 'admin' as const };

export interface BackendOptions {
  setupRequired?: boolean;
  envProviderAvailable?: boolean;
  escrow?: boolean;
  signedIn?: boolean;
}

/** Instance and session endpoints every routed test needs. */
export function mockBackend({
  setupRequired = false,
  envProviderAvailable = false,
  escrow = false,
  signedIn = false,
}: BackendOptions = {}): void {
  server.use(
    http.get('/api/instance', () =>
      HttpResponse.json({
        setupRequired,
        mode: setupRequired ? null : 'personal',
        registration: setupRequired ? null : 'closed',
        version: '0.1.0',
        envProviderAvailable,
        escrow,
      }),
    ),
    http.get('/api/auth/me', () =>
      signedIn
        ? HttpResponse.json({ user: testUser })
        : HttpResponse.json(
            { error: { code: 'unauthorized', message: 'Sign in to continue.' } },
            { status: 401 },
          ),
    ),
    // The app shell loads these once signed in; tests that care override them.
    http.get('/api/conversations', () => HttpResponse.json({ items: [], nextCursor: null })),
    http.get('/api/conversations/:id', () =>
      HttpResponse.json(
        { error: { code: 'not_found', message: 'That chat does not exist.' } },
        { status: 404 },
      ),
    ),
    http.get('/api/folders', () => HttpResponse.json({ folders: [] })),
    http.get('/api/presets', () => HttpResponse.json({ presets: [] })),
    http.get('/api/models', () => HttpResponse.json({ providers: [] })),
    http.get('/api/tools', () => HttpResponse.json({ tools: [], webSearchBackend: false })),
    http.get('/api/generations/active', () => HttpResponse.json({ items: [] })),
  );
}

export function renderApp(path = '/') {
  const queryClient = createQueryClient();
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const user = userEvent.setup();
  render(<App router={router} queryClient={queryClient} />);
  return { router, queryClient, user };
}
