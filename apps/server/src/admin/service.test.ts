import type { MessagePublic } from '@neotext/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  addUser,
  authContextFor,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';
import { createGeneration } from '../chat/generation/generation';
import { aad } from '../crypto/aad';
import { open, seal } from '../crypto/aead';
import type { AuthContext } from '../http/env';

let t: TestApp;
let owner: Awaited<ReturnType<typeof setupOwner>>;
let actor: AuthContext;
beforeEach(async () => {
  t = await createTestApp();
  owner = await setupOwner(t, { mode: 'community' });
  actor = authContextFor(t, owner.cookie);
});
afterEach(async () => {
  await t.close();
});

const LAST_ADMIN = 'NeoText needs at least one active admin.';
const NO_ESCROW =
  "This account can't be reset without losing its chats. The user can reset it with their recovery key.";
const PASSWORD = 'correct horse battery';

const login = (username: string, password: string) =>
  t.app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3420' },
    body: JSON.stringify({ username, password }),
  });
const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
const me = (cookie: string) => t.app.request('/api/auth/me', { headers: { cookie } });
const escrowKeys = () =>
  t.c.db.raw.prepare('SELECT id, dek_by_instance AS k FROM users ORDER BY id').all() as {
    id: string;
    k: Buffer | null;
  }[];

function runningGeneration(userId: string) {
  const model = { providerId: 'prv_1', modelId: 'm/1' };
  const message: MessagePublic = {
    id: 'msg_running',
    conversationId: 'cnv_1',
    parentId: null,
    role: 'assistant',
    status: 'streaming',
    parts: [],
    model,
    usage: null,
    finishReason: null,
    createdAt: 1,
    updatedAt: 1,
  };
  const g = createGeneration({
    id: 'gen_running',
    userId,
    conversationId: 'cnv_1',
    message,
    model,
    startedAt: 1,
    log: t.c.log,
  });
  // Runs until it is aborted, like a model call waiting on the network.
  t.c.generations.start(
    g,
    (run) => new Promise<void>((done) => run.signal.addEventListener('abort', () => done())),
  );
  return g;
}

describe('the last admin cannot be removed', () => {
  test('demoting or disabling the only admin is a conflict', () => {
    for (const body of [{ role: 'member' as const }, { status: 'disabled' as const }]) {
      expect(() => t.c.admin.updateUser(actor, owner.user.id, body)).toThrowError(
        expect.objectContaining({ code: 'conflict', status: 409, message: LAST_ADMIN }),
      );
    }
    expect(t.c.users.findById(owner.user.id)).toMatchObject({ role: 'admin', status: 'active' });
  });

  test('a disabled admin does not count', async () => {
    const other = await addUser(t, 'deputy', 'admin');
    t.c.users.setStatus(other.userId, 'disabled');
    expect(() => t.c.admin.updateUser(actor, owner.user.id, { role: 'member' })).toThrowError(
      expect.objectContaining({ message: LAST_ADMIN }),
    );
  });

  test('with a second active admin, either may step down, but not both', async () => {
    const other = await addUser(t, 'deputy', 'admin');
    const updated = t.c.admin.updateUser(actor, owner.user.id, { role: 'member' });
    expect(updated).toMatchObject({ id: owner.user.id, role: 'member', status: 'active' });
    expect(() => t.c.admin.updateUser(other.auth, other.userId, { status: 'disabled' })).toThrow(
      LAST_ADMIN,
    );
  });

  test('an unknown user is not found', () => {
    expect(() => t.c.admin.updateUser(actor, 'usr_missing', { role: 'member' })).toThrowError(
      expect.objectContaining({ code: 'not_found', status: 404 }),
    );
  });

  test('changes are audited', async () => {
    const member = await addUser(t, 'member1');
    t.c.admin.updateUser(actor, member.userId, { role: 'admin' });
    const rows = t.c.db.raw
      .prepare("SELECT user_id, meta FROM audit_events WHERE kind = 'admin.user.updated'")
      .all() as { user_id: string; meta: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBe(owner.user.id);
    expect(JSON.parse(rows[0]?.meta ?? '{}')).toEqual({ targetId: member.userId, role: 'admin' });
  });
});

test('disabling signs the user out', async () => {
  const member = await addUser(t, 'member1');
  const g = runningGeneration(member.userId);
  expect((await me(member.cookie)).status).toBe(200);
  const updated = t.c.admin.updateUser(actor, member.userId, { status: 'disabled' });
  expect(updated.status).toBe('disabled');
  expect((await me(member.cookie)).status).toBe(401);
  expect(t.c.sessions.listForUser(member.userId)).toEqual([]);
  expect(g.signal.aborted).toBe(true);
  expect((await login('member1', PASSWORD)).status).toBe(403);
  t.c.admin.updateUser(actor, member.userId, { status: 'active' });
  expect((await login('member1', PASSWORD)).status).toBe(200);
});

describe('users()', () => {
  test('lists last seen and this UTC month known cost', async () => {
    const member = await addUser(t, 'member1');
    const now = t.clock.now();
    const monthStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1);
    const insert = t.c.db.raw.prepare(
      `INSERT INTO usage_events (id, user_id, provider_id, model_id, kind, prompt_tokens,
        completion_tokens, reasoning_tokens, cached_tokens, cost_usd, web_search_requests, created_at)
       VALUES (?, ?, 'prv_1', 'm/1', 'chat', 1, 1, 0, 0, ?, 0, ?)`,
    );
    insert.run('use_1', member.userId, 0.25, now);
    insert.run('use_2', member.userId, 0.5, monthStart);
    insert.run('use_3', member.userId, null, now);
    insert.run('use_4', member.userId, 9, monthStart - 1);
    const users = t.c.admin.users();
    expect(users.map((u) => u.username)).toEqual(['daryl', 'member1']);
    const row = users.find((u) => u.id === member.userId);
    expect(row).toMatchObject({ role: 'member', status: 'active', lastSeenAt: now });
    expect(row?.monthCostUsd).toBeCloseTo(0.75);
    expect(users.find((u) => u.id === owner.user.id)?.monthCostUsd).toBe(0);
    t.c.sessions.revokeAllForUser(member.userId);
    expect(t.c.admin.users().find((u) => u.id === member.userId)?.lastSeenAt).toBeNull();
  });
});

test('reset needs escrow', async () => {
  const member = await addUser(t, 'member1');
  await expect(t.c.admin.resetPassword(actor, member.userId)).rejects.toMatchObject({
    code: 'conflict',
    status: 409,
    message: NO_ESCROW,
  });
  // On, but this user has not signed in since: still no escrow key.
  t.c.admin.updateInstance(actor, { escrow: true });
  await expect(t.c.admin.resetPassword(actor, member.userId)).rejects.toMatchObject({
    message: NO_ESCROW,
  });
});

test('with escrow, reset keeps chats readable', async () => {
  t.c.admin.updateInstance(actor, { escrow: true });
  const member = await addUser(t, 'member1');
  const signedIn = await login('member1', PASSWORD);
  expect(signedIn.status).toBe(200);
  const auth = authContextFor(t, cookieOf(signedIn));
  expect(t.c.users.findById(member.userId)?.dekByInstance).toBeInstanceOf(Buffer);
  const sealed = seal(auth.dek, Buffer.from('my secret chat'), aad('messages', 'parts', 'msg_1'));

  const logSpy = vi.spyOn(t.c.log, 'info');
  const { temporaryPassword } = await t.c.admin.resetPassword(actor, member.userId);
  expect(temporaryPassword).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{16}$/);
  expect((await me(cookieOf(signedIn))).status).toBe(401);
  expect((await login('member1', PASSWORD)).status).toBe(401);

  const again = await login('member1', temporaryPassword);
  expect(again.status).toBe(200);
  const dek = authContextFor(t, cookieOf(again)).dek;
  expect(open(dek, sealed, aad('messages', 'parts', 'msg_1')).toString()).toBe('my secret chat');

  const audit = JSON.stringify(t.c.db.raw.prepare('SELECT * FROM audit_events').all());
  expect(audit).toContain('admin.password.reset');
  expect(audit).not.toContain(temporaryPassword);
  expect(JSON.stringify(logSpy.mock.calls)).not.toContain(temporaryPassword);
});

test('turning escrow off erases the escrow keys', async () => {
  t.c.admin.updateInstance(actor, { escrow: true });
  await addUser(t, 'member1');
  expect((await login('daryl', owner.password)).status).toBe(200);
  expect((await login('member1', PASSWORD)).status).toBe(200);
  expect(escrowKeys().every((r) => r.k !== null)).toBe(true);
  const off = t.c.admin.updateInstance(actor, { escrow: false });
  expect(off).toEqual({
    mode: 'community',
    registration: 'invite',
    escrow: false,
    defaultQuota: null,
  });
  expect(escrowKeys().map((r) => r.k)).toEqual([null, null]);
  // Logging in with escrow off writes nothing.
  expect((await login('member1', PASSWORD)).status).toBe(200);
  expect(escrowKeys().map((r) => r.k)).toEqual([null, null]);
  const kinds = t.c.db.raw
    .prepare("SELECT meta FROM audit_events WHERE kind = 'admin.instance.updated'")
    .all() as { meta: string }[];
  expect(kinds.map((k) => JSON.parse(k.meta))).toEqual([{ escrow: true }, { escrow: false }]);
});

test('instance settings round-trip and show in the public instance info', () => {
  expect(t.c.admin.instance()).toEqual({
    mode: 'community',
    registration: 'invite',
    escrow: false,
    defaultQuota: null,
  });
  t.c.admin.updateInstance(actor, { registration: 'open', escrow: true });
  expect(t.c.admin.instance()).toEqual({
    mode: 'community',
    registration: 'open',
    escrow: true,
    defaultQuota: null,
  });
  expect(t.c.auth.instanceInfo()).toMatchObject({ registration: 'open', escrow: true });
});

describe('personal mode takes no sign-ups', () => {
  test('switching to personal closes registration, and /api/instance says so', async () => {
    t.c.admin.updateInstance(actor, { registration: 'open' });
    expect(t.c.admin.updateInstance(actor, { mode: 'personal' })).toEqual({
      mode: 'personal',
      registration: 'closed',
      escrow: false,
      defaultQuota: null,
    });
    expect(t.c.instance.get('registration')).toBe('closed');
    const info = await (await t.app.request('/api/instance')).json();
    expect(info).toMatchObject({ mode: 'personal', registration: 'closed' });
    const rows = t.c.db.raw
      .prepare("SELECT meta FROM audit_events WHERE kind = 'admin.instance.updated' ORDER BY rowid")
      .all() as { meta: string }[];
    expect(JSON.parse(rows.at(-1)?.meta ?? '{}')).toEqual({
      mode: 'personal',
      registration: 'closed',
    });
  });

  test('opening sign-ups on a personal instance is refused', () => {
    t.c.admin.updateInstance(actor, { mode: 'personal' });
    for (const body of [
      { registration: 'open' as const },
      { mode: 'personal' as const, registration: 'invite' as const },
    ]) {
      expect(() => t.c.admin.updateInstance(actor, body)).toThrowError(
        expect.objectContaining({ code: 'conflict', details: { reason: 'personal_signups' } }),
      );
    }
    expect(t.c.admin.instance().registration).toBe('closed');
    // Back to community: sign-ups stay closed until the admin opens them.
    expect(t.c.admin.updateInstance(actor, { mode: 'community' }).registration).toBe('closed');
    expect(t.c.admin.updateInstance(actor, { registration: 'invite' }).registration).toBe('invite');
  });

  test('a personal instance with a stale stored policy still refuses sign-ups', async () => {
    t.c.instance.set('mode', 'personal');
    t.c.instance.set('registration', 'open');
    expect(t.c.auth.instanceInfo().registration).toBe('closed');
    expect(t.c.admin.instance().registration).toBe('closed');
    const res = await t.app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3420' },
      body: JSON.stringify({ username: 'walkin', password: 'a long enough passphrase' }),
    });
    expect(res.status).toBe(403);
    expect(t.c.users.count()).toBe(1);
  });
});
