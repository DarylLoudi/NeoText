import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { server } from '../../test/msw';
import { ApiError, apiFetch, setUnauthorizedHandler } from './client';

const unauthorized = (path: string) =>
  http.get(path, () =>
    HttpResponse.json(
      { error: { code: 'unauthorized', message: 'Sign in to continue.' } },
      { status: 401 },
    ),
  );

afterEach(() => setUnauthorizedHandler(() => {}));

describe('apiFetch', () => {
  test('returns JSON and sends credentials', async () => {
    let seen: Request | undefined;
    server.use(
      http.post('/api/things', async ({ request }) => {
        seen = request.clone();
        return HttpResponse.json({ ok: true });
      }),
    );
    const out = await apiFetch<{ ok: boolean }>('/things', { method: 'POST', body: { a: 1 } });
    expect(out).toEqual({ ok: true });
    expect(seen?.credentials).toBe('same-origin');
    expect(seen?.headers.get('content-type')).toBe('application/json');
    expect(await seen?.json()).toEqual({ a: 1 });
  });

  test('maps an error body to ApiError', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json(
          {
            error: {
              code: 'invalid_credentials',
              message: 'Username or password is incorrect.',
              requestId: 'r1',
            },
          },
          { status: 401 },
        ),
      ),
    );
    const err = await apiFetch('/auth/login', { method: 'POST', body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      code: 'invalid_credentials',
      status: 401,
      requestId: 'r1',
      message: 'Username or password is incorrect.',
    });
  });

  test('network failure is ApiError network', async () => {
    server.use(http.get('/api/down', () => HttpResponse.error()));
    await expect(apiFetch('/down')).rejects.toMatchObject({ code: 'network', status: 0 });
  });

  test('401 calls the unauthorized handler, except /auth/me and /auth/login', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    server.use(
      unauthorized('/api/conversations'),
      unauthorized('/api/auth/me'),
      unauthorized('/api/auth/login'),
    );
    await expect(apiFetch('/auth/me')).rejects.toMatchObject({ status: 401 });
    await expect(apiFetch('/auth/login')).rejects.toMatchObject({ status: 401 });
    expect(handler).not.toHaveBeenCalled();
    await expect(apiFetch('/conversations')).rejects.toMatchObject({ code: 'unauthorized' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('a wrong password on a signed-in route is not a lost session', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    server.use(
      http.post('/api/auth/password', () =>
        HttpResponse.json(
          { error: { code: 'invalid_credentials', message: 'Username or password is incorrect.' } },
          { status: 401 },
        ),
      ),
    );
    await expect(apiFetch('/auth/password', { method: 'POST', body: {} })).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  test('204 resolves to undefined', async () => {
    server.use(http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })));
    await expect(apiFetch('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  test('non-JSON error body still yields an ApiError', async () => {
    server.use(http.get('/api/boom', () => new HttpResponse('bad gateway', { status: 502 })));
    await expect(apiFetch('/boom')).rejects.toMatchObject({ code: 'internal', status: 502 });
  });
});
