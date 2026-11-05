import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test } from 'vitest';
import { createQueryClient } from '../lib/query';
import { server } from '../test/msw';
import { useInstance, useSession, useSignOut } from './session';

const user = { id: 'u1', username: 'ada', displayName: 'Ada', role: 'admin' };
let client = createQueryClient();
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  client = createQueryClient();
});

describe('session hooks', () => {
  test('useSession is null when signed out', async () => {
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json(
          { error: { code: 'unauthorized', message: 'Sign in.' } },
          { status: 401 },
        ),
      ),
    );
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  test('useSession returns the unwrapped user', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ user })));
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(user));
  });

  test('useInstance returns instance info', async () => {
    const info = {
      setupRequired: false,
      mode: 'personal',
      registration: 'closed',
      version: '0.1.0',
      envProviderAvailable: false,
      escrow: false,
    };
    server.use(http.get('/api/instance', () => HttpResponse.json(info)));
    const { result } = renderHook(() => useInstance(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(info));
  });

  test('useSignOut logs out and clears the session and cache', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ user })),
      http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })),
    );
    const { result } = renderHook(() => ({ s: useSession(), out: useSignOut() }), { wrapper });
    await waitFor(() => expect(result.current.s.data).toEqual(user));
    await result.current.out.mutateAsync();
    await waitFor(() => expect(client.getQueryData(['session'])).toBeNull());
    expect(client.getQueryData(['conversations'])).toBeUndefined();
  });
});
