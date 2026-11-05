import { createHmac, randomBytes } from 'node:crypto';
import type { InvitePublic } from '@neotext/shared';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { CROCKFORD_ALPHABET, foldConfusables } from '../crypto/recovery-key';
import type { DbHandle } from '../db/client';
import { invites, users } from '../db/schema';

const PREFIX = 'NTXI';
const CODE_CHARS = 12; // 60 random bits, 5 per character

/** `NTXI-XXXX-XXXX-XXXX`: 60 random bits in the same Crockford alphabet as recovery keys. */
export function generateInviteCode(): string {
  let bits = randomBytes(8).readBigUInt64BE() >> 4n;
  let out = '';
  for (let i = 0; i < CODE_CHARS; i++) {
    out = CROCKFORD_ALPHABET[Number(bits & 31n)] + out;
    bits >>= 5n;
  }
  return `${PREFIX}-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`;
}

/** Same forgiveness as recovery keys: case, spaces, dashes, the prefix and O/I/L are ignored. */
function normalizeInviteCode(input: string): string {
  let s = input.toUpperCase().replace(/[\s-]+/g, '');
  if (s.length === CODE_CHARS + PREFIX.length && s.startsWith(PREFIX)) s = s.slice(PREFIX.length);
  return foldConfusables(s);
}

/** Hex HMAC-SHA256 under the instance key. Only this is stored; the code is shown once. */
export function hashInviteCode(instanceKey: Buffer, code: string): string {
  return createHmac('sha256', instanceKey).update(normalizeInviteCode(code)).digest('hex');
}

export interface InviteRow extends InvitePublic {
  codeHash: string;
  createdBy: string;
}

export interface NewInvite {
  id: string;
  codeHash: string;
  role: 'admin' | 'member';
  createdBy: string;
  expiresAt: number;
  createdAt: number;
}

export interface InvitesRepo {
  insert(row: NewInvite): void;
  /** Newest first, with the username of whoever used each. Never includes the hash. */
  list(): InvitePublic[];
  findByHash(hash: string): InviteRow | null;
  /**
   * Marks the invite used. One atomic statement: true only for the caller that found it unused
   * and unexpired, so two sign-ups with the same code cannot both win.
   */
  consume(id: string, userId: string, at: number): boolean;
  /** Deletes the invite, used or not. False when it does not exist. */
  revoke(id: string): boolean;
}

export function createInvitesRepo(db: DbHandle): InvitesRepo {
  const toPublic = (
    r: typeof invites.$inferSelect,
    usedByUsername: string | null = null,
  ): InvitePublic => ({
    id: r.id,
    role: r.role,
    expiresAt: r.expiresAt,
    usedBy: r.usedBy,
    usedByUsername,
    usedAt: r.usedAt,
    createdAt: r.createdAt,
  });
  return {
    insert(row) {
      db.orm.insert(invites).values(row).run();
    },
    list() {
      return db.orm
        .select({ invite: invites, username: users.username })
        .from(invites)
        .leftJoin(users, eq(users.id, invites.usedBy))
        .orderBy(desc(invites.createdAt), desc(invites.id))
        .all()
        .map((r) => toPublic(r.invite, r.username));
    },
    findByHash(hash) {
      const r = db.orm.select().from(invites).where(eq(invites.codeHash, hash)).get();
      return r ? { ...toPublic(r), codeHash: r.codeHash, createdBy: r.createdBy } : null;
    },
    consume(id, userId, at) {
      const res = db.orm
        .update(invites)
        .set({ usedBy: userId, usedAt: at })
        .where(and(eq(invites.id, id), isNull(invites.usedAt), gt(invites.expiresAt, at)))
        .run();
      return res.changes === 1;
    },
    revoke(id) {
      return db.orm.delete(invites).where(eq(invites.id, id)).run().changes === 1;
    },
  };
}
