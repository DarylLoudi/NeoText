import type { AdminUser, InvitePublic } from '@neotext/shared';
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  addUser,
  authed,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

type ErrBody = { error: { code: string; message: string } };

test('members get 403 on admin routes', async () => {
  await setupOwner(t, { mode: 'community' });
  const member = await addUser(t, 'member1');
  const asMember = authed(t, member.cookie);
  const calls: [string, string][] = [
    ['GET', '/api/admin/users'],
    ['PATCH', `/api/admin/users/${member.userId}`],
    ['POST', `/api/admin/users/${member.userId}/reset-password`],
    ['GET', '/api/admin/instance'],
    ['PATCH', '/api/admin/instance'],
  ];
  for (const [method, path] of calls) {
    const body = method === 'GET' ? undefined : '{}';
    expect((await asMember(path, { method, body })).status).toBe(403);
    expect((await t.app.request(path, { method })).status).toBe(401);
  }
});

test('admins manage users and the instance over HTTP', async () => {
  const owner = await setupOwner(t, { mode: 'community' });
  const member = await addUser(t, 'member1');
  const call = authed(t, owner.cookie);

  const list = await call('/api/admin/users');
  expect(list.status).toBe(200);
  expect(list.headers.get('cache-control')).toBe('no-store');
  const { users } = (await list.json()) as { users: AdminUser[] };
  expect(users.map((u) => u.username)).toEqual(['daryl', 'member1']);
  expect(JSON.stringify(users)).not.toMatch(/dek|verifier|salt/i);

  const promoted = await call(`/api/admin/users/${member.userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role: 'admin' }),
  });
  expect(promoted.status).toBe(200);
  expect(((await promoted.json()) as { user: AdminUser }).user.role).toBe('admin');

  const bad = await call(`/api/admin/users/${member.userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role: 'owner' }),
  });
  expect(bad.status).toBe(400);

  const instance = await call('/api/admin/instance', {
    method: 'PATCH',
    body: JSON.stringify({ escrow: true }),
  });
  expect(await instance.json()).toEqual({
    mode: 'community',
    registration: 'invite',
    escrow: true,
    defaultQuota: null,
  });
  expect(await (await call('/api/admin/instance')).json()).toMatchObject({ escrow: true });
  expect(await (await t.app.request('/api/instance')).json()).toMatchObject({ escrow: true });
});

test('the last admin conflict reaches the client', async () => {
  const owner = await setupOwner(t, { mode: 'community' });
  const res = await authed(t, owner.cookie)(`/api/admin/users/${owner.user.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ role: 'member' }),
  });
  expect(res.status).toBe(409);
  expect(((await res.json()) as ErrBody).error).toEqual(
    expect.objectContaining({
      code: 'conflict',
      message: 'NeoText needs at least one active admin.',
      details: { reason: 'last_admin' },
    }),
  );
});

test('reset without escrow is a conflict; with escrow it returns the password once', async () => {
  const owner = await setupOwner(t, { mode: 'community' });
  const call = authed(t, owner.cookie);
  await addUser(t, 'member1');
  const id = t.c.users.findByUsername('member1')?.id ?? '';
  const refused = await call(`/api/admin/users/${id}/reset-password`, { method: 'POST' });
  expect(refused.status).toBe(409);

  await call('/api/admin/instance', { method: 'PATCH', body: JSON.stringify({ escrow: true }) });
  const signIn = await t.app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3420' },
    body: JSON.stringify({ username: 'member1', password: 'correct horse battery' }),
  });
  expect(signIn.status).toBe(200);
  const reset = await call(`/api/admin/users/${id}/reset-password`, { method: 'POST' });
  expect(reset.status).toBe(200);
  expect(reset.headers.get('cache-control')).toBe('no-store');
  const { temporaryPassword } = (await reset.json()) as { temporaryPassword: string };
  expect(temporaryPassword).toHaveLength(16);
});

test('the invite list names who used each code', async () => {
  const owner = await setupOwner(t, { mode: 'community' });
  const call = authed(t, owner.cookie);
  const created = await call('/api/admin/invites', { method: 'POST', body: '{}' });
  const { code } = (await created.json()) as { code: string };
  const joined = await t.app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3420' },
    body: JSON.stringify({
      username: 'newbie',
      password: 'a long enough passphrase',
      inviteCode: code,
    }),
  });
  expect(joined.status).toBe(201);
  const { invites } = (await (await call('/api/admin/invites')).json()) as {
    invites: (InvitePublic & { usedByUsername: string | null })[];
  };
  expect(invites[0]?.usedByUsername).toBe('newbie');
});
