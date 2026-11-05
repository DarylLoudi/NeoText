import type { InvitePublic, PublicUser } from '@neotext/shared';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { authed, createTestApp, setupOwner, type TestApp } from '../../test-support/test-app';
import { hashInviteCode } from './invites';
import { register } from './register';

type ErrBody = { error: { code: string; message: string } };
type Registered = { user: PublicUser; recoveryKey: string };

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

const PASSWORD = 'a long enough passphrase';
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
const signUp = (username: string, inviteCode?: string) =>
  post('/api/auth/register', {
    username,
    password: PASSWORD,
    ...(inviteCode !== undefined ? { inviteCode } : {}),
  });

/** A community instance with an owner, plus a helper that mints invites through the real route. */
async function community(registration: 'closed' | 'invite' | 'open' = 'invite') {
  const owner = await setupOwner(t, { mode: 'community' });
  t.c.instance.set('registration', registration);
  const call = authed(t, owner.cookie);
  const invite = async (body: { role?: 'admin' | 'member'; expiresInDays?: number } = {}) => {
    const res = await call('/api/admin/invites', { method: 'POST', body: JSON.stringify(body) });
    expect(res.status).toBe(201);
    return (await res.json()) as { invite: InvitePublic; code: string };
  };
  return { owner, call, invite };
}

test('closed registration refuses', async () => {
  const { invite } = await community('closed');
  const { code } = await invite();
  const res = await signUp('newbie', code);
  expect(res.status).toBe(403);
  expect(((await res.json()) as ErrBody).error).toMatchObject({
    code: 'forbidden',
    message: 'Sign-ups are closed. Ask the admin for access.',
  });
  expect(t.c.users.count()).toBe(1);
});

test('registration is closed before the instance is set up', async () => {
  expect((await signUp('newbie')).status).toBe(403);
});

test('invite flow creates a member and consumes the code', async () => {
  const { invite } = await community();
  const { code, invite: created } = await invite();
  const res = await signUp('Newbie', code);
  expect(res.status).toBe(201);
  const body = (await res.json()) as Registered;
  expect(body.user).toMatchObject({ username: 'newbie', role: 'member' });
  expect(body.recoveryKey).toMatch(/^NTXR-/);
  const setCookie = res.headers.get('set-cookie') ?? '';
  expect(setCookie).toContain('HttpOnly');
  const cookie = setCookie.split(';')[0] ?? '';
  expect(cookie).toMatch(/^neotext_session=/);
  expect((await t.app.request('/api/auth/me', { headers: { cookie } })).status).toBe(200);
  expect(t.c.invites.list().find((i) => i.id === created.id)).toMatchObject({
    usedBy: body.user.id,
  });
  const login = await post('/api/auth/login', { username: 'newbie', password: PASSWORD });
  expect(login.status).toBe(200);
  const audited = t.c.db.raw
    .prepare("SELECT user_id FROM audit_events WHERE kind = 'auth.registered'")
    .all();
  expect(audited).toEqual([{ user_id: body.user.id }]);
});

test('invite role is applied', async () => {
  const { invite } = await community();
  const { code } = await invite({ role: 'admin' });
  const res = await signUp('deputy', code);
  expect(res.status).toBe(201);
  expect(((await res.json()) as Registered).user.role).toBe('admin');
});

test('expired and reused codes fail the same way', async () => {
  const { invite } = await community();
  const expired = await invite({ expiresInDays: 1 });
  const used = await invite();
  expect((await signUp('first', used.code)).status).toBe(201);
  t.clock.advance(2 * 24 * 60 * 60 * 1000);
  const failures: { status: number; body: ErrBody }[] = [];
  for (const code of [expired.code, used.code, 'NTXI-0000-0000-0000']) {
    const res = await signUp('second', code);
    failures.push({ status: res.status, body: (await res.json()) as ErrBody });
  }
  for (const f of failures) {
    expect(f.status).toBe(403);
    expect(f.body.error).toMatchObject({
      code: 'forbidden',
      message: 'That invite code is not valid.',
    });
  }
  expect(t.c.users.count()).toBe(2);
});

test('a missing code is refused with the same message', async () => {
  await community();
  const res = await signUp('newbie');
  expect(res.status).toBe(403);
  expect(((await res.json()) as ErrBody).error.message).toBe('That invite code is not valid.');
});

test('a revoked invite no longer works', async () => {
  const { invite, call } = await community();
  const { code, invite: created } = await invite();
  expect((await call(`/api/admin/invites/${created.id}`, { method: 'DELETE' })).status).toBe(204);
  expect((await signUp('newbie', code)).status).toBe(403);
});

test('an invite works once under a race', async () => {
  const { invite } = await community();
  const { code } = await invite();
  const attempt = (username: string) =>
    register(t.c, { username, password: PASSWORD, inviteCode: code }, null);
  const r = await Promise.allSettled([attempt('racer-a'), attempt('racer-b')]);
  expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  const rejected = r.find((x) => x.status === 'rejected');
  expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({
    code: 'forbidden',
    message: 'That invite code is not valid.',
  });
  expect(t.c.users.count()).toBe(2); // owner + one
});

test('a taken username keeps the invite unused', async () => {
  const { invite } = await community();
  const { code, invite: created } = await invite();
  const res = await signUp('DARYL', code);
  expect(res.status).toBe(409);
  expect(((await res.json()) as ErrBody).error).toMatchObject({
    code: 'conflict',
    message: 'That username is taken.',
  });
  expect(t.c.invites.list().find((i) => i.id === created.id)?.usedAt).toBeNull();
  expect((await signUp('newbie', code)).status).toBe(201);
});

test('the same username cannot register twice at once', async () => {
  await community('open');
  const r = await Promise.allSettled([
    register(t.c, { username: 'twin', password: PASSWORD }, null),
    register(t.c, { username: 'twin', password: PASSWORD }, null),
  ]);
  expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  const rejected = r.find((x) => x.status === 'rejected');
  expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({ code: 'conflict' });
});

test('invalid usernames and passwords are rejected before the code is checked', async () => {
  const { invite } = await community();
  const { code } = await invite();
  expect((await signUp('x', code)).status).toBe(400);
  const short = await post('/api/auth/register', {
    username: 'newbie',
    password: 'short',
    inviteCode: code,
  });
  expect(short.status).toBe(400);
  expect(t.c.invites.list()[0]?.usedAt).toBeNull();
});

test('invite codes are rate limited', async () => {
  await community();
  for (let i = 0; i < 5; i++) {
    expect((await signUp('newbie', 'NTXI-0000-0000-0000')).status).toBe(403);
  }
  const blocked = await signUp('newbie', 'NTXI-0000-0000-0000');
  expect(blocked.status).toBe(429);
  expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
});

describe('admin routes', () => {
  test('the code is shown once and stored hashed', async () => {
    const { invite, call, owner } = await community();
    const { code, invite: created } = await invite();
    expect(code).toMatch(/^NTXI-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(created).toMatchObject({ role: 'member', usedBy: null, usedAt: null });
    expect(created.expiresAt).toBe(t.clock.now() + 14 * 24 * 60 * 60 * 1000);
    const text = await (await call('/api/admin/invites')).text();
    expect(text).not.toContain(code);
    expect(text).not.toContain('codeHash');
    expect(JSON.parse(text).invites).toHaveLength(1);
    const row = t.c.db.raw.prepare('SELECT code_hash, created_by FROM invites').get() as {
      code_hash: string;
      created_by: string;
    };
    expect(row.code_hash).not.toBe(code);
    expect(row.code_hash).toBe(hashInviteCode(t.c.instanceKey, code));
    expect(row.created_by).toBe(owner.user.id);
  });

  test('only admins manage invites, and bad bodies are rejected', async () => {
    const { call, invite } = await community();
    expect((await t.app.request('/api/admin/invites')).status).toBe(401);
    const { code } = await invite();
    const joined = await signUp('member1', code);
    const memberCookie = (joined.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const asMember = authed(t, memberCookie);
    expect((await asMember('/api/admin/invites')).status).toBe(403);
    expect((await asMember('/api/admin/invites', { method: 'POST', body: '{}' })).status).toBe(403);
    expect((await asMember('/api/admin/invites/inv_x', { method: 'DELETE' })).status).toBe(403);
    for (const body of [{ expiresInDays: 0 }, { expiresInDays: 91 }, { role: 'owner' }]) {
      const res = await call('/api/admin/invites', { method: 'POST', body: JSON.stringify(body) });
      expect(res.status).toBe(400);
    }
    expect((await call('/api/admin/invites/inv_missing', { method: 'DELETE' })).status).toBe(404);
  });

  test('creating and revoking are audited', async () => {
    const { invite, call } = await community();
    const { invite: created } = await invite();
    await call(`/api/admin/invites/${created.id}`, { method: 'DELETE' });
    const kinds = t.c.db.raw
      .prepare("SELECT kind FROM audit_events WHERE kind LIKE 'admin.invite.%' ORDER BY rowid")
      .all();
    expect(kinds).toEqual([{ kind: 'admin.invite.created' }, { kind: 'admin.invite.revoked' }]);
  });
});

test('code input is forgiving', async () => {
  const { invite } = await community();
  const { code } = await invite();
  const sloppy = code.toLowerCase().replace(/-/g, ' ');
  expect((await signUp('newbie', `  ${sloppy}  `)).status).toBe(201);
});

test('open registration needs no code', async () => {
  await community('open');
  const res = await signUp('walkin');
  expect(res.status).toBe(201);
  expect(((await res.json()) as Registered).user.role).toBe('member');
});

test('open registration ignores a code that is sent anyway', async () => {
  await community('open');
  expect((await signUp('walkin', 'NTXI-0000-0000-0000')).status).toBe(201);
});

test('validation errors name the field they belong to', async () => {
  await community('open');
  const badName = await signUp('x');
  expect(badName.status).toBe(400);
  const nameErr = ((await badName.json()) as ErrBody & { error: { details: unknown } }).error;
  expect(nameErr.code).toBe('validation_failed');
  expect(nameErr.details).toEqual([{ path: ['username'], message: nameErr.message }]);
  const short = await post('/api/auth/register', { username: 'newbie', password: 'short' });
  const pwErr = ((await short.json()) as ErrBody & { error: { details: unknown } }).error;
  expect(pwErr.details).toEqual([{ path: ['password'], message: pwErr.message }]);
});

test('a display name past 80 characters is refused on the field', async () => {
  await community('open');
  const res = await post('/api/auth/register', {
    username: 'panjang',
    password: PASSWORD,
    displayName: 'x'.repeat(81),
  });
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({
    error: { code: 'validation_failed', details: [{ path: ['displayName'] }] },
  });
  expect(t.c.users.count()).toBe(1);
  const ok = await post('/api/auth/register', {
    username: 'pas',
    password: PASSWORD,
    displayName: 'x'.repeat(80),
  });
  expect(ok.status).toBe(201);
});
