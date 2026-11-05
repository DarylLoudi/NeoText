import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  addUser,
  authed,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';
import { SESSION_IDLE_MS } from './sessions';

type ErrBody = { error: { code: string; message: string; details?: { path: unknown[] }[] } };

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

const post = (path: string, body: unknown, cookie?: string) =>
  t.app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3420',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
const get = (path: string, cookie?: string) =>
  t.app.request(path, { headers: cookie ? { cookie } : {} });
const wrongLogin = () => post('/api/auth/login', { username: 'daryl', password: 'wrong' });

test('first run: instance → setup → me → logout', async () => {
  expect(await (await t.app.request('/api/instance')).json()).toMatchObject({
    setupRequired: true,
    mode: null,
  });
  const res = await post('/api/setup', {
    username: 'daryl',
    password: 'correct horse battery',
    mode: 'personal',
  });
  expect(res.status).toBe(201);
  const setCookie = res.headers.get('set-cookie') ?? '';
  expect(setCookie).toMatch(/^neotext_session=/);
  expect(setCookie).toContain('HttpOnly');
  expect(setCookie).toContain('SameSite=Strict');
  expect(setCookie).toContain('Path=/');
  expect(setCookie).toContain('Max-Age=2592000');
  const cookie = setCookie.split(';')[0] ?? '';
  const me = (await (await get('/api/auth/me', cookie)).json()) as { user: { username: string } };
  expect(me.user.username).toBe('daryl');
  expect((await post('/api/auth/logout', {}, cookie)).status).toBe(204);
  expect((await get('/api/auth/me', cookie)).status).toBe(401);
});

test('secure deployments use the __Host- cookie name and Secure flag', async () => {
  await t.close();
  t = await createTestApp({ env: { NEOTEXT_PUBLIC_URL: 'https://chat.example.com' } });
  const res = await t.app.request('/api/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://chat.example.com' },
    body: JSON.stringify({
      username: 'daryl',
      password: 'correct horse battery',
      mode: 'personal',
    }),
  });
  expect(res.status).toBe(201);
  const setCookie = res.headers.get('set-cookie') ?? '';
  expect(setCookie).toMatch(/^__Host-neotext_session=/);
  expect(setCookie).toContain('Secure');
});

test('bad cookie is cleared', async () => {
  const res = await get('/api/auth/me', 'neotext_session=garbage');
  expect(res.status).toBe(401);
  expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
});

test('unauthenticated protected routes are 401 and set no cookie', async () => {
  const res = await get('/api/auth/me');
  expect(res.status).toBe(401);
  expect(((await res.json()) as ErrBody).error.code).toBe('unauthorized');
  expect(res.headers.get('set-cookie')).toBeNull();
});

test('login succeeds, and wrong credentials are 401', async () => {
  const owner = await setupOwner(t);
  const ok = await post('/api/auth/login', { username: 'Daryl', password: owner.password });
  expect(ok.status).toBe(200);
  expect(ok.headers.get('set-cookie')).toMatch(/^neotext_session=/);
  const bad = await wrongLogin();
  expect(bad.status).toBe(401);
  expect(((await bad.json()) as ErrBody).error.code).toBe('invalid_credentials');
});

test('login is limited per username and the limit resets on success', async () => {
  const owner = await setupOwner(t);
  for (let i = 0; i < 4; i++) expect((await wrongLogin()).status).toBe(401);
  const ok = await post('/api/auth/login', { username: 'daryl', password: owner.password });
  expect(ok.status).toBe(200);
  for (let i = 0; i < 5; i++) expect((await wrongLogin()).status).toBe(401);
  const blocked = await wrongLogin();
  expect(blocked.status).toBe(429);
  expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
  expect(((await blocked.json()) as ErrBody).error.code).toBe('rate_limited');
});

test('login is limited per IP', async () => {
  await setupOwner(t);
  let last = 0;
  for (let i = 0; i < 11; i++) {
    last = (await post('/api/auth/login', { username: `user${i}`, password: 'wrong' })).status;
  }
  expect(last).toBe(429);
});

test('validation errors point at the field', async () => {
  const res = await post('/api/setup', { username: 'daryl', password: 'short', mode: 'personal' });
  const body = (await res.json()) as ErrBody;
  expect(body.error.code).toBe('validation_failed');
  expect(body.error.details?.[0]?.path).toEqual(['password']);
  const bad = await post('/api/setup', {
    username: 'x',
    password: 'correct horse battery',
    mode: 'personal',
  });
  expect(((await bad.json()) as ErrBody).error.details?.[0]?.path).toEqual(['username']);
});

test('login does not enforce the new-password rules', async () => {
  await setupOwner(t);
  expect((await wrongLogin()).status).toBe(401);
});

test('password change keeps this session and enforces the rules', async () => {
  const owner = await setupOwner(t);
  const call = authed(t, owner.cookie);
  const change = (newPassword: string) =>
    call('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: owner.password, newPassword }),
    });
  const weak = await change('short');
  expect(weak.status).toBe(400);
  expect(((await weak.json()) as ErrBody).error.details?.[0]?.path).toEqual(['newPassword']);
  expect((await change('a brand new passphrase')).status).toBe(204);
  expect((await call('/api/auth/me')).status).toBe(200);
  const login = await post('/api/auth/login', {
    username: 'daryl',
    password: 'a brand new passphrase',
  });
  expect(login.status).toBe(200);
});

test('recovery-key rotation returns a new key', async () => {
  const owner = await setupOwner(t);
  const res = await authed(t, owner.cookie)('/api/auth/recovery-key', {
    method: 'POST',
    body: JSON.stringify({ password: owner.password }),
  });
  expect(res.status).toBe(200);
  const { recoveryKey } = (await res.json()) as { recoveryKey: string };
  expect(recoveryKey).not.toBe(owner.recoveryKey);
});

test('recover over HTTP returns a new key and signs in', async () => {
  const owner = await setupOwner(t);
  const res = await post('/api/auth/recover', {
    username: 'daryl',
    recoveryKey: owner.recoveryKey,
    newPassword: 'another long passphrase',
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { recoveryKey: string };
  expect(body.recoveryKey).not.toBe(owner.recoveryKey);
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  expect(cookie).toMatch(/^neotext_session=/);
  expect((await get('/api/auth/me', cookie)).status).toBe(200);
  expect((await get('/api/auth/me', owner.cookie)).status).toBe(401);
});

test('recover is limited per IP', async () => {
  await setupOwner(t);
  const attempt = () =>
    post('/api/auth/recover', {
      username: 'daryl',
      recoveryKey: 'wrong',
      newPassword: 'long enough pass',
    });
  for (let i = 0; i < 5; i++) expect((await attempt()).status).toBe(400);
  const blocked = await attempt();
  expect(blocked.status).toBe(429);
  expect(blocked.headers.get('retry-after')).not.toBeNull();
});

test('a session on a disabled account is signed out and cannot change credentials', async () => {
  const owner = await setupOwner(t);
  t.c.users.setStatus(owner.user.id, 'disabled');
  const call = authed(t, owner.cookie);
  const change = await call('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify({
      currentPassword: owner.password,
      newPassword: 'a brand new passphrase',
    }),
  });
  expect(change.status).toBe(401);
  expect(change.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  const rotate = await call('/api/auth/recovery-key', {
    method: 'POST',
    body: JSON.stringify({ password: owner.password }),
  });
  expect(rotate.status).toBe(401);
  expect((await call('/api/auth/me')).status).toBe(401);
});

test('signed-in API use is limited per user', async () => {
  const owner = await setupOwner(t);
  const call = authed(t, owner.cookie);
  for (let i = 0; i < 300; i++) expect((await call('/api/auth/me')).status).toBe(200);
  const blocked = await call('/api/auth/me');
  expect(blocked.status).toBe(429);
  expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
  t.clock.advance(60_000);
  expect((await call('/api/auth/me')).status).toBe(200);
});

const DAY = 86_400_000;
const maxAgeOf = (res: Response) =>
  Number(/Max-Age=(\d+)/.exec(res.headers.get('set-cookie') ?? '')?.[1]);

test('the cookie is re-issued when the session slides, and not within the touch window', async () => {
  const owner = await setupOwner(t);
  const call = authed(t, owner.cookie);
  t.clock.advance(60_000);
  expect((await call('/api/auth/me')).headers.get('set-cookie')).toBeNull();
  t.clock.advance(5 * 60_000);
  const slid = await call('/api/auth/me');
  expect(slid.headers.get('set-cookie')).toMatch(/^neotext_session=/);
  expect(maxAgeOf(slid)).toBe(2_592_000);
  t.clock.advance(60_000);
  expect((await call('/api/auth/me')).headers.get('set-cookie')).toBeNull();
});

test('near the absolute limit the cookie lives no longer than the session', async () => {
  const owner = await setupOwner(t);
  const call = authed(t, owner.cookie);
  for (let i = 0; i < 8; i++) {
    t.clock.advance(20 * DAY);
    expect((await call('/api/auth/me')).status).toBe(200);
  }
  t.clock.advance(15 * DAY);
  const res = await call('/api/auth/me');
  expect(res.status).toBe(200);
  expect(maxAgeOf(res)).toBeGreaterThan(0);
  expect(maxAgeOf(res)).toBeLessThanOrEqual(5 * 86_400);
});

test('logout on a request that also slid ends with the cookie cleared', async () => {
  const owner = await setupOwner(t);
  t.clock.advance(10 * 60_000);
  const res = await authed(t, owner.cookie)('/api/auth/logout', { method: 'POST', body: '{}' });
  expect(res.status).toBe(204);
  const cookies = res.headers.getSetCookie();
  expect(cookies).toHaveLength(1);
  expect(cookies[0]).toMatch(/Max-Age=0/);
});

test('password checks are limited to 5 per minute per user', async () => {
  const owner = await setupOwner(t);
  const call = authed(t, owner.cookie);
  const wrong = () =>
    call('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: 'wrong', newPassword: 'a brand new passphrase' }),
    });
  for (let i = 0; i < 5; i++) expect((await wrong()).status).toBe(401);
  const blocked = await wrong();
  expect(blocked.status).toBe(429);
  expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
});

test('recovery-key rotation password checks are limited to 5 per minute per user', async () => {
  const owner = await setupOwner(t);
  const call = authed(t, owner.cookie);
  const wrong = () =>
    call('/api/auth/recovery-key', { method: 'POST', body: JSON.stringify({ password: 'wrong' }) });
  for (let i = 0; i < 5; i++) expect((await wrong()).status).toBe(401);
  const blocked = await wrong();
  expect(blocked.status).toBe(429);
  expect(blocked.headers.get('retry-after')).not.toBeNull();
});

describe('dead session cookies are rejected and cleared', () => {
  const expectCleared = async (cookie: string) => {
    const res = await get('/api/auth/me', cookie);
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  };

  test('an expired cookie', async () => {
    const owner = await setupOwner(t);
    t.clock.advance(SESSION_IDLE_MS + 1);
    await expectCleared(owner.cookie);
  });

  test('a cookie revoked by logout', async () => {
    const owner = await setupOwner(t);
    expect((await post('/api/auth/logout', {}, owner.cookie)).status).toBe(204);
    await expectCleared(owner.cookie);
  });

  test('a cookie revoked by recover', async () => {
    const owner = await setupOwner(t);
    const res = await post('/api/auth/recover', {
      username: 'daryl',
      recoveryKey: owner.recoveryKey,
      newPassword: 'another long passphrase',
    });
    expect(res.status).toBe(200);
    await expectCleared(owner.cookie);
  });
});

describe('device sessions', () => {
  type SessionItem = {
    id: string;
    createdAt: number;
    lastSeenAt: number;
    expiresAt: number;
    userAgent: string | null;
    current: boolean;
  };
  const signIn = async (userAgent: string) => {
    const res = await t.app.request('/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3420',
        'user-agent': userAgent,
      },
      body: JSON.stringify({ username: 'daryl', password: 'correct horse battery' }),
    });
    return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  };
  const sessionsOf = async (cookie: string) =>
    ((await (await authed(t, cookie)('/api/auth/sessions')).json()) as { items: SessionItem[] })
      .items;
  const revokedCount = () =>
    t.c.db.raw.prepare("SELECT kind FROM audit_events WHERE kind = 'session.revoked'").all().length;

  test('sessions list marks the current one', async () => {
    const owner = await setupOwner(t);
    const phone = await signIn('Phone/1.0');
    const items = await sessionsOf(owner.cookie);
    expect(items).toHaveLength(2);
    expect(items.filter((s) => s.current)).toHaveLength(1);
    expect(items.find((s) => s.current)?.userAgent).toBeNull();
    const fromPhone = await sessionsOf(phone);
    expect(fromPhone.find((s) => s.current)?.userAgent).toBe('Phone/1.0');
    const res = await authed(t, owner.cookie)('/api/auth/sessions');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(items)).not.toMatch(/dek|token/i);
    expect((await get('/api/auth/sessions')).status).toBe(401);
  });

  test('a very long user agent is stored cut', async () => {
    const owner = await setupOwner(t);
    const phone = await signIn(`Phone/1.0 ${'x'.repeat(10_000)}`);
    const stored = (await sessionsOf(phone)).find((s) => s.current)?.userAgent;
    expect(stored).toHaveLength(256);
    expect(stored?.startsWith('Phone/1.0 x')).toBe(true);
    // The store caps it too, whatever the caller passes.
    const direct = t.c.sessions.create(owner.user.id, Buffer.alloc(32), 'y'.repeat(5000));
    const row = t.c.sessions.listForUser(owner.user.id).find((s) => s.id === direct.sessionId);
    expect(row?.userAgent).toHaveLength(256);
    const empty = t.c.sessions.create(owner.user.id, Buffer.alloc(32), '');
    expect(
      t.c.sessions.listForUser(owner.user.id).find((s) => s.id === empty.sessionId)?.userAgent,
    ).toBeNull();
  });

  test('revoking another session signs it out', async () => {
    const owner = await setupOwner(t);
    const phone = await signIn('Phone/1.0');
    const other = (await sessionsOf(owner.cookie)).find((s) => !s.current);
    const res = await authed(t, owner.cookie)(`/api/auth/sessions/${other?.id}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(204);
    expect((await get('/api/auth/me', phone)).status).toBe(401);
    expect((await get('/api/auth/me', owner.cookie)).status).toBe(200);
    expect(revokedCount()).toBe(1);
  });

  test("another user's session id is 404", async () => {
    const owner = await setupOwner(t, { mode: 'community' });
    const member = await addUser(t, 'member1');
    const theirs = (await sessionsOf(member.cookie))[0];
    const res = await authed(t, owner.cookie)(`/api/auth/sessions/${theirs?.id}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
    expect((await get('/api/auth/me', member.cookie)).status).toBe(200);
    expect(
      (await authed(t, owner.cookie)('/api/auth/sessions/nope', { method: 'DELETE' })).status,
    ).toBe(404);
    expect(revokedCount()).toBe(0);
  });

  test('revoking the current session signs this device out', async () => {
    const owner = await setupOwner(t);
    const current = (await sessionsOf(owner.cookie)).find((s) => s.current);
    const res = await authed(t, owner.cookie)(`/api/auth/sessions/${current?.id}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect((await get('/api/auth/me', owner.cookie)).status).toBe(401);
  });

  test('revoke-others keeps the current session', async () => {
    const owner = await setupOwner(t);
    const phone = await signIn('Phone/1.0');
    const tablet = await signIn('Tablet/1.0');
    const res = await authed(t, owner.cookie)('/api/auth/sessions/revoke-others', {
      method: 'POST',
      body: '{}',
    });
    expect(res.status).toBe(204);
    expect((await get('/api/auth/me', owner.cookie)).status).toBe(200);
    expect((await get('/api/auth/me', phone)).status).toBe(401);
    expect((await get('/api/auth/me', tablet)).status).toBe(401);
    expect(await sessionsOf(owner.cookie)).toHaveLength(1);
    expect(revokedCount()).toBe(1);
  });

  test('expired sessions are not listed', async () => {
    const owner = await setupOwner(t);
    await signIn('Phone/1.0');
    // The owner's session slides forward when used; the phone's does not.
    t.clock.advance(SESSION_IDLE_MS - 1000);
    await get('/api/auth/me', owner.cookie);
    t.clock.advance(2000);
    const items = await sessionsOf(owner.cookie);
    expect(items.map((s) => s.userAgent)).toEqual([null]);
  });
});
