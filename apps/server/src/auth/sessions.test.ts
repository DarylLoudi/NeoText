import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createTestApp, type TestApp } from '../../test-support/test-app';
import { randomKey } from '../crypto/kdf';
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from './sessions';

let t: TestApp;
const userId = 'usr_01HZZZZZZZZZZZZZZZZZZZZZZZ';

beforeEach(async () => {
  t = await createTestApp();
  const now = t.clock.now();
  t.c.db.raw
    .prepare(
      `INSERT INTO users (id, username, display_name, role, status, kdf_salt, kdf_params,
        auth_verifier, dek_by_password, dek_by_recovery, created_at, updated_at, password_changed_at)
       VALUES (?, 'u1', 'U', 'member', 'active', x'00', '{}', x'00', x'00', x'00', ?, ?, ?)`,
    )
    .run(userId, now, now, now);
});
afterEach(() => t.close());

describe('sessions', () => {
  test('resolve returns the DEK', () => {
    const dek = randomKey();
    const s = t.c.sessions.create(userId, dek, 'agent');
    expect(t.c.sessions.resolve(s.token)?.dek.equals(dek)).toBe(true);
    expect(t.c.sessions.resolve('garbage')).toBeNull();
  });

  test('idle expiry after 30 days', () => {
    const s = t.c.sessions.create(userId, randomKey(), null);
    t.clock.advance(SESSION_IDLE_MS + 1);
    expect(t.c.sessions.resolve(s.token)).toBeNull();
  });

  test('use slides the expiry, at most every 5 minutes', () => {
    const s = t.c.sessions.create(userId, randomKey(), null);
    t.clock.advance(6 * 60_000);
    const first = t.c.sessions.resolve(s.token);
    expect(first?.expiresAt).toBeGreaterThan(s.expiresAt);
    t.clock.advance(60_000);
    expect(t.c.sessions.resolve(s.token)?.expiresAt).toBe(first?.expiresAt);
  });

  test('absolute limit of 180 days', () => {
    const s = t.c.sessions.create(userId, randomKey(), null);
    const createdAt = t.clock.now();
    for (let day = 29; day < 180; day += 29) {
      t.clock.advance(29 * 86_400_000);
      expect(t.c.sessions.resolve(s.token)).not.toBeNull();
    }
    t.clock.set(createdAt + 179 * 86_400_000);
    expect(t.c.sessions.resolve(s.token)?.expiresAt).toBe(createdAt + SESSION_ABSOLUTE_MS);
    t.clock.set(createdAt + SESSION_ABSOLUTE_MS + 1);
    expect(t.c.sessions.resolve(s.token)).toBeNull();
  });

  test('revoke drops the session and its cached DEK', () => {
    const s = t.c.sessions.create(userId, randomKey(), null);
    t.c.sessions.revoke(s.sessionId);
    expect(t.c.sessions.resolve(s.token)).toBeNull();
  });

  test('revokeAllForUser keeps the excepted session', () => {
    const a = t.c.sessions.create(userId, randomKey(), null);
    const b = t.c.sessions.create(userId, randomKey(), null);
    expect(t.c.sessions.revokeAllForUser(userId, a.sessionId)).toBe(1);
    expect(t.c.sessions.resolve(a.token)).not.toBeNull();
    expect(t.c.sessions.resolve(b.token)).toBeNull();
    expect(t.c.sessions.listForUser(userId)).toHaveLength(1);
  });
});
