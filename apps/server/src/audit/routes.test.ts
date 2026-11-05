import { AUDIT_KINDS, type AuditListResponse } from '@neotext/shared';
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  addUser,
  authed,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';
import { AUDIT_KINDS as SERVER_KINDS } from './audit';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

const list = async (cookie: string, query = '') => {
  const res = await authed(t, cookie)(`/api/audit${query}`);
  return { res, body: (await res.json()) as AuditListResponse };
};

test('the shared kind list equals the server list', () => {
  expect([...AUDIT_KINDS]).toEqual([...SERVER_KINDS]);
});

test('audit shows own events; all needs admin', async () => {
  const owner = await setupOwner(t, { mode: 'community' });
  const member = await addUser(t, 'member1');
  t.c.audit.record('auth.login.success', member.userId);
  t.c.audit.record('auth.logout', owner.user.id);

  const mine = await list(member.cookie);
  expect(mine.res.status).toBe(200);
  expect(mine.res.headers.get('cache-control')).toBe('no-store');
  expect(mine.body.items.map((e) => e.kind)).toEqual(['auth.login.success']);
  expect(mine.body.items.every((e) => e.userId === member.userId)).toBe(true);

  // A member cannot ask for everyone's events, nor for another user's.
  expect((await list(member.cookie, '?all=1')).res.status).toBe(403);
  const other = await list(member.cookie, `?userId=${owner.user.id}`);
  expect(other.body.items.every((e) => e.userId === member.userId)).toBe(true);

  const all = await list(owner.cookie, '?all=1');
  expect(all.res.status).toBe(200);
  expect(new Set(all.body.items.map((e) => e.userId))).toEqual(
    new Set([owner.user.id, member.userId]),
  );
  const one = await list(owner.cookie, `?all=1&userId=${member.userId}`);
  expect(one.body.items.every((e) => e.userId === member.userId)).toBe(true);

  expect((await t.app.request('/api/audit')).status).toBe(401);
});

test('pages are newest first with an opaque cursor', async () => {
  const owner = await setupOwner(t);
  for (let i = 0; i < 5; i++) {
    t.clock.advance(1000);
    t.c.audit.record('data.exported', owner.user.id, { format: `f${i}` });
  }
  const first = await list(owner.cookie, '?limit=3');
  expect(first.body.items.map((e) => e.details.format)).toEqual(['f4', 'f3', 'f2']);
  expect(first.body.nextCursor).toBeTypeOf('string');
  expect(first.body.nextCursor).not.toMatch(/f2|aud_/);
  const second = await list(owner.cookie, `?limit=3&cursor=${first.body.nextCursor}`);
  expect(second.body.items.slice(0, 2).map((e) => e.details.format)).toEqual(['f1', 'f0']);
  expect(second.body.nextCursor).toBeNull();
  expect((await list(owner.cookie, '?cursor=garbage')).res.status).toBe(400);
  expect((await list(owner.cookie, '?limit=0')).res.status).toBe(400);
});

test('every key the writers store is allowlisted', async () => {
  const owner = await setupOwner(t);
  // The keys used by each audit.record call site in the server.
  const meta = {
    targetId: 't',
    inviteId: 'i',
    role: 'admin',
    status: 'disabled',
    mode: 'community',
    registration: 'invite',
    escrow: true,
    via: 'invite',
    format: 'json',
    source: 'chatgpt',
    imported: 1,
    skipped: 0,
    failed: 0,
    error: false,
    count: 1,
    version: 3,
    from: 1,
    to: 2,
  };
  t.c.audit.record('admin.instance.updated', owner.user.id, meta);
  const { body } = await list(owner.cookie);
  expect(body.items.find((e) => e.kind === 'admin.instance.updated')?.details).toEqual(meta);
});

test('only an allowlist of details reaches the client', async () => {
  const owner = await setupOwner(t);
  t.c.audit.record('data.imported', owner.user.id, {
    source: 'chatgpt',
    imported: 2,
    secret: 'sk-or-test-leak',
    token: 'abc',
  });
  const { body } = await list(owner.cookie);
  const event = body.items.find((e) => e.kind === 'data.imported');
  expect(event?.details).toEqual({ source: 'chatgpt', imported: 2 });
  expect(JSON.stringify(body)).not.toContain('sk-or-test-leak');
});
