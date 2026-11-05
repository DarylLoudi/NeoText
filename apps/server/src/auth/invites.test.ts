import { newId } from '@neotext/shared';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { addUser, createTestApp, type TestApp } from '../../test-support/test-app';
import { generateInviteCode, hashInviteCode } from './invites';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

test('codes look like NTXI-XXXX-XXXX-XXXX in the Crockford alphabet', () => {
  const code = generateInviteCode();
  expect(code).toMatch(/^NTXI-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  expect(new Set(Array.from({ length: 50 }, generateInviteCode)).size).toBe(50);
});

test('the hash ignores case, spaces, dashes, the prefix and confusable letters', () => {
  const key = Buffer.alloc(32, 7);
  const base = hashInviteCode(key, 'NTXI-0123-4567-89AB');
  expect(base).toMatch(/^[0-9a-f]{64}$/);
  expect(hashInviteCode(key, 'ntxi 0123 4567 89ab')).toBe(base);
  expect(hashInviteCode(key, '0123456789AB')).toBe(base);
  expect(hashInviteCode(key, ' O123-4567-89AB ')).toBe(base);
  expect(hashInviteCode(key, 'NTXI-I123-4567-89AB')).toBe(
    hashInviteCode(key, 'NTXI-1123-4567-89AB'),
  );
  expect(hashInviteCode(key, 'NTXI-0123-4567-89AC')).not.toBe(base);
  expect(hashInviteCode(Buffer.alloc(32, 8), 'NTXI-0123-4567-89AB')).not.toBe(base);
});

const seed = async (id = newId('inv'), expiresAt = t.clock.now() + 1000) => {
  const admin = await addUser(t, 'boss', 'admin');
  t.c.invites.insert({
    id,
    codeHash: id,
    role: 'member',
    createdBy: admin.userId,
    expiresAt,
    createdAt: t.clock.now(),
  });
  return { id, adminId: admin.userId };
};

test('consume works once, for an unexpired invite', async () => {
  const { id } = await seed();
  const member = await addUser(t, 'newbie');
  const other = await addUser(t, 'other');
  expect(t.c.invites.consume(id, member.userId, t.clock.now())).toBe(true);
  expect(t.c.invites.consume(id, other.userId, t.clock.now())).toBe(false);
  const listed = t.c.invites.list().find((i) => i.id === id);
  expect(listed).toMatchObject({ usedBy: member.userId, usedAt: t.clock.now() });
});

test('consume refuses an expired invite', async () => {
  const { id } = await seed(undefined, t.clock.now() + 1000);
  const member = await addUser(t, 'newbie');
  t.clock.advance(1000);
  expect(t.c.invites.consume(id, member.userId, t.clock.now())).toBe(false);
});

test('list never exposes the hash, and revoke removes the invite', async () => {
  const { id } = await seed();
  const [row] = t.c.invites.list();
  expect(row).toBeDefined();
  expect(Object.keys(row ?? {}).sort()).toEqual(
    ['createdAt', 'expiresAt', 'id', 'role', 'usedAt', 'usedBy', 'usedByUsername'].sort(),
  );
  expect(t.c.invites.findByHash(id)?.id).toBe(id);
  expect(t.c.invites.revoke(id)).toBe(true);
  expect(t.c.invites.revoke(id)).toBe(false);
  expect(t.c.invites.list()).toHaveLength(0);
});
