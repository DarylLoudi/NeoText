import { randomBytes } from 'node:crypto';
import { and, eq, gt, max, ne } from 'drizzle-orm';
import { sha256 } from '../crypto/kdf';
import { unwrapForSession, wrapForSession } from '../crypto/vault';
import type { DbHandle } from '../db/client';
import { sessions } from '../db/schema';
import type { Clock } from '../lib/clock';

export const SESSION_IDLE_MS = 30 * 86_400_000;
export const SESSION_ABSOLUTE_MS = 180 * 86_400_000;
export const SESSION_TOUCH_MS = 5 * 60_000;
/** A user agent is a label for the device list, so a longer one is cut. */
export const USER_AGENT_MAX = 256;
const CACHE_MAX = 1000;
const CACHE_TTL_MS = 10 * 60_000;

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  dek: Buffer;
  expiresAt: number;
  /** True only on the resolve that moved `lastSeenAt` and `expiresAt` forward. */
  slid: boolean;
}

export interface SessionStore {
  create(
    userId: string,
    dek: Buffer,
    userAgent: string | null,
  ): { token: string; sessionId: string; expiresAt: number };
  resolve(token: string): ResolvedSession | null;
  revoke(sessionId: string): void;
  revokeAllForUser(userId: string, exceptSessionId?: string): number;
  listForUser(userId: string): {
    id: string;
    createdAt: number;
    lastSeenAt: number;
    expiresAt: number;
    userAgent: string | null;
  }[];
  /** The latest `lastSeenAt` of each user's unexpired sessions; users without one are absent. */
  lastSeenByUser(): Map<string, number>;
}

export function createSessionStore(db: DbHandle, clock: Clock): SessionStore {
  // Map keeps insertion order, so the first key is the least recently used.
  const cache = new Map<string, { dek: Buffer; at: number }>();
  const cacheGet = (id: string): Buffer | null => {
    const hit = cache.get(id);
    if (!hit) return null;
    if (clock.now() - hit.at > CACHE_TTL_MS) {
      cache.delete(id);
      return null;
    }
    cache.delete(id);
    cache.set(id, hit);
    return hit.dek;
  };
  const cachePut = (id: string, dek: Buffer) => {
    cache.delete(id);
    cache.set(id, { dek, at: clock.now() });
    if (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  };
  const revoke = (sessionId: string) => {
    cache.delete(sessionId);
    db.orm.delete(sessions).where(eq(sessions.id, sessionId)).run();
  };

  return {
    create(userId, dek, userAgent) {
      const token = randomBytes(32).toString('base64url');
      const sessionId = sha256(token).toString('hex');
      const now = clock.now();
      const expiresAt = now + SESSION_IDLE_MS;
      db.orm
        .insert(sessions)
        .values({
          id: sessionId,
          userId,
          dekWrapped: wrapForSession(sessionId, token, dek),
          createdAt: now,
          lastSeenAt: now,
          expiresAt,
          userAgent: userAgent?.slice(0, USER_AGENT_MAX) || null,
        })
        .run();
      cachePut(sessionId, dek);
      return { token, sessionId, expiresAt };
    },
    resolve(token) {
      const sessionId = sha256(token).toString('hex');
      const row = db.orm.select().from(sessions).where(eq(sessions.id, sessionId)).get();
      if (!row) return null;
      const now = clock.now();
      if (now > row.expiresAt || now > row.createdAt + SESSION_ABSOLUTE_MS) {
        revoke(sessionId);
        return null;
      }
      let dek = cacheGet(sessionId);
      if (!dek) {
        dek = unwrapForSession(sessionId, token, row.dekWrapped);
        if (!dek) return null;
        cachePut(sessionId, dek);
      }
      let expiresAt = row.expiresAt;
      let slid = false;
      if (now - row.lastSeenAt >= SESSION_TOUCH_MS) {
        expiresAt = Math.min(now + SESSION_IDLE_MS, row.createdAt + SESSION_ABSOLUTE_MS);
        db.orm
          .update(sessions)
          .set({ lastSeenAt: now, expiresAt })
          .where(eq(sessions.id, sessionId))
          .run();
        slid = true;
      }
      return { sessionId, userId: row.userId, dek, expiresAt, slid };
    },
    revoke,
    revokeAllForUser(userId, exceptSessionId) {
      const where = exceptSessionId
        ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId))
        : eq(sessions.userId, userId);
      const rows = db.orm.select({ id: sessions.id }).from(sessions).where(where).all();
      for (const r of rows) cache.delete(r.id);
      return db.orm.delete(sessions).where(where).run().changes;
    },
    listForUser(userId) {
      return db.orm
        .select({
          id: sessions.id,
          createdAt: sessions.createdAt,
          lastSeenAt: sessions.lastSeenAt,
          expiresAt: sessions.expiresAt,
          userAgent: sessions.userAgent,
        })
        .from(sessions)
        .where(eq(sessions.userId, userId))
        .all();
    },
    lastSeenByUser() {
      const rows = db.orm
        .select({ userId: sessions.userId, at: max(sessions.lastSeenAt) })
        .from(sessions)
        .where(gt(sessions.expiresAt, clock.now()))
        .groupBy(sessions.userId)
        .all();
      return new Map(rows.flatMap((r) => (r.at === null ? [] : [[r.userId, r.at] as const])));
    },
  };
}
