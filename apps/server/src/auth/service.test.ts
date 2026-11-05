import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createTestApp, type TestApp } from '../../test-support/test-app';
import { open, seal } from '../crypto/aead';
import { unlockWithPassword } from '../crypto/vault';
import type { AuthContext } from '../http/env';

let t: TestApp;
const PW = 'correct horse battery';
const setupBody = (username = 'daryl', password = PW) => ({
  username,
  password,
  mode: 'personal' as const,
});

/** Resolves to the rejection (code and message) or null when the promise succeeds. */
const failure = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code: string; message: string }) => e,
  );

beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

async function ctxFor(token: string): Promise<AuthContext> {
  const s = t.c.sessions.resolve(token);
  if (!s) throw new Error('no session');
  const u = t.c.users.findById(s.userId);
  if (!u) throw new Error('no user');
  return { userId: u.id, username: u.username, role: u.role, sessionId: s.sessionId, dek: s.dek };
}

function userOrThrow(id: string) {
  const u = t.c.users.findById(id);
  if (!u) throw new Error('missing user');
  return u;
}

describe('auth service', () => {
  test('setup creates the admin and a recovery key', async () => {
    const r = await t.c.auth.setup(setupBody(), null);
    expect(r.user.role).toBe('admin');
    expect(r.recoveryKey).toMatch(/^NTXR-/);
    const info = t.c.auth.instanceInfo();
    expect(info.setupRequired).toBe(false);
    expect(info.mode).toBe('personal');
    expect(info.registration).toBe('closed');
    expect(t.c.instance.get('escrow')).toBe(false);
  });

  test('community mode starts with invite registration', async () => {
    await t.c.auth.setup({ ...setupBody(), mode: 'community' }, null);
    expect(t.c.auth.instanceInfo().registration).toBe('invite');
  });

  test('setup rejects bad input', async () => {
    expect((await failure(t.c.auth.setup(setupBody('a'), null)))?.code).toBe('validation_failed');
    expect((await failure(t.c.auth.setup(setupBody('daryl', 'short'), null)))?.code).toBe(
      'validation_failed',
    );
    expect(t.c.users.count()).toBe(0);
  });

  test('setup runs once even when called twice at the same time', async () => {
    const results = await Promise.allSettled([
      t.c.auth.setup(setupBody('daryl'), null),
      t.c.auth.setup(setupBody('other'), null),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected');
    expect((failed as PromiseRejectedResult).reason.code).toBe('already_setup');
    expect(t.c.users.count()).toBe(1);
  });

  test('login returns a session that unlocks the same DEK', async () => {
    await t.c.auth.setup(setupBody(), null);
    const r = await t.c.auth.login({ username: 'daryl', password: PW }, 'ua');
    const user = userOrThrow(r.user.id);
    const dek = await unlockWithPassword(user.id, user, PW);
    expect(dek).not.toBeNull();
    expect(t.c.sessions.resolve(r.token)?.dek.equals(dek as Buffer)).toBe(true);
  });

  test('unknown user and wrong password give the same error', async () => {
    await t.c.auth.setup(setupBody(), null);
    const a = await failure(
      t.c.auth.login({ username: 'nobody', password: 'whatever pass' }, null),
    );
    const b = await failure(
      t.c.auth.login({ username: 'daryl', password: 'wrong password!' }, null),
    );
    expect(a?.code).toBe('invalid_credentials');
    expect(b?.code).toBe('invalid_credentials');
    expect(a?.message).toBe(b?.message);
    const rows = t.c.db.raw
      .prepare("SELECT count(*) AS n FROM audit_events WHERE kind = 'auth.login.failure'")
      .get() as { n: number };
    expect(rows.n).toBe(1);
  });

  test('username is case- and space-insensitive', async () => {
    await t.c.auth.setup(setupBody(), null);
    const r = await t.c.auth.login({ username: ' Daryl ', password: PW }, null);
    expect(r.user.username).toBe('daryl');
  });

  test('disabled account cannot sign in', async () => {
    const { user } = await t.c.auth.setup(setupBody(), null);
    t.c.users.setStatus(user.id, 'disabled');
    const e = await failure(t.c.auth.login({ username: 'daryl', password: PW }, null));
    expect(e?.code).toBe('account_disabled');
  });

  test('changing the password keeps data readable and signs out other sessions', async () => {
    const first = await t.c.auth.setup(setupBody(), null);
    const other = await t.c.auth.login({ username: 'daryl', password: PW }, null);
    const auth = await ctxFor(first.token);
    const sealed = seal(auth.dek, Buffer.from('secret'), 'aad');
    const wrong = await failure(
      t.c.auth.changePassword(auth, {
        currentPassword: 'nope nope nope',
        newPassword: 'brand new password',
      }),
    );
    expect(wrong?.code).toBe('invalid_credentials');
    await t.c.auth.changePassword(auth, { currentPassword: PW, newPassword: 'brand new password' });
    const user = userOrThrow(auth.userId);
    const dek = await unlockWithPassword(user.id, user, 'brand new password');
    expect(open(dek as Buffer, sealed, 'aad').toString()).toBe('secret');
    expect(await unlockWithPassword(user.id, user, PW)).toBeNull();
    expect(t.c.sessions.resolve(other.token)).toBeNull();
    expect(t.c.sessions.resolve(first.token)).not.toBeNull();
    await t.c.auth.login({ username: 'daryl', password: 'brand new password' }, null);
    const old = await failure(t.c.auth.login({ username: 'daryl', password: PW }, null));
    expect(old?.code).toBe('invalid_credentials');
  });

  test('recovery resets the password and replaces the recovery key', async () => {
    const first = await t.c.auth.setup(setupBody(), null);
    const rec = await t.c.auth.recover(
      { username: 'daryl', recoveryKey: first.recoveryKey, newPassword: 'recovered password' },
      null,
    );
    expect(rec.recoveryKey).not.toBe(first.recoveryKey);
    expect(t.c.sessions.resolve(first.token)).toBeNull();
    expect(t.c.sessions.resolve(rec.token)).not.toBeNull();
    await t.c.auth.login({ username: 'daryl', password: 'recovered password' }, null);
    const old = await failure(t.c.auth.login({ username: 'daryl', password: PW }, null));
    expect(old?.code).toBe('invalid_credentials');
    const again = await failure(
      t.c.auth.recover(
        { username: 'daryl', recoveryKey: first.recoveryKey, newPassword: 'another password' },
        null,
      ),
    );
    expect(again?.code).toBe('invalid_recovery_key');
    const unknown = await failure(
      t.c.auth.recover(
        { username: 'nobody', recoveryKey: rec.recoveryKey, newPassword: 'another password' },
        null,
      ),
    );
    expect(unknown?.code).toBe('invalid_recovery_key');
  });

  test('rotating the recovery key needs the password and retires the old key', async () => {
    const first = await t.c.auth.setup(setupBody(), null);
    const auth = await ctxFor(first.token);
    const wrong = await failure(
      t.c.auth.rotateRecoveryKey(auth, { password: 'wrong wrong wrong' }),
    );
    expect(wrong?.code).toBe('invalid_credentials');
    const { recoveryKey } = await t.c.auth.rotateRecoveryKey(auth, { password: PW });
    expect(recoveryKey).not.toBe(first.recoveryKey);
    const old = await failure(
      t.c.auth.recover(
        { username: 'daryl', recoveryKey: first.recoveryKey, newPassword: 'another password' },
        null,
      ),
    );
    expect(old?.code).toBe('invalid_recovery_key');
    await t.c.auth.recover(
      { username: 'daryl', recoveryKey, newPassword: 'another password' },
      null,
    );
  });

  test('concurrent recovery key rotations: the returned key is the one that works', async () => {
    const first = await t.c.auth.setup(setupBody(), null);
    const auth = await ctxFor(first.token);
    const results = await Promise.allSettled([
      t.c.auth.rotateRecoveryKey(auth, { password: PW }),
      t.c.auth.rotateRecoveryKey(auth, { password: PW }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    const key = (ok[0] as PromiseFulfilledResult<{ recoveryKey: string }>).value.recoveryKey;
    const rec = await t.c.auth.recover(
      { username: 'daryl', recoveryKey: key, newPassword: 'another password' },
      null,
    );
    expect(rec.token).toBeTruthy();
  });

  test('concurrent recoveries: exactly one wins and its key works', async () => {
    const first = await t.c.auth.setup(setupBody(), null);
    const body = (newPassword: string) => ({
      username: 'daryl',
      recoveryKey: first.recoveryKey,
      newPassword,
    });
    const results = await Promise.allSettled([
      t.c.auth.recover(body('first new password'), null),
      t.c.auth.recover(body('second new password'), null),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    const won = (ok[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof t.c.auth.recover>>>)
      .value;
    expect(t.c.sessions.resolve(won.token)).not.toBeNull();
    const again = await t.c.auth.recover(
      { username: 'daryl', recoveryKey: won.recoveryKey, newPassword: 'third new password' },
      null,
    );
    expect(again.token).toBeTruthy();
  });

  test('a login in flight across a password change yields no live session', async () => {
    const first = await t.c.auth.setup(setupBody(), null);
    const auth = await ctxFor(first.token);
    const results = await Promise.allSettled([
      t.c.auth.login({ username: 'daryl', password: PW }, null),
      t.c.auth.changePassword(auth, { currentPassword: PW, newPassword: 'brand new password' }),
    ]);
    expect(results[1]?.status).toBe('fulfilled');
    // The change revokes every other session; a late login must not slip one in afterwards.
    expect(t.c.sessions.listForUser(auth.userId).map((x) => x.id)).toEqual([auth.sessionId]);
  });

  test('logout removes the session', async () => {
    const first = await t.c.auth.setup(setupBody(), null);
    const auth = await ctxFor(first.token);
    t.c.auth.logout(auth.sessionId, auth.userId);
    expect(t.c.sessions.resolve(first.token)).toBeNull();
  });
});
