import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import type { Argon2Params } from '../crypto/kdf';
import type { DbHandle } from '../db/client';
import { users } from '../db/schema';
import type { Clock } from '../lib/clock';

export interface UserRow {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'member';
  status: 'active' | 'disabled';
  kdfSalt: Buffer;
  kdfParams: Argon2Params;
  authVerifier: Buffer;
  dekByPassword: Buffer;
  dekByRecovery: Buffer;
  dekByInstance: Buffer | null;
  createdAt: number;
  updatedAt: number;
  passwordChangedAt: number;
}

export type VaultPatch = Partial<
  Pick<
    UserRow,
    | 'kdfSalt'
    | 'kdfParams'
    | 'authVerifier'
    | 'dekByPassword'
    | 'dekByRecovery'
    | 'dekByInstance'
    | 'passwordChangedAt'
  >
>;

export interface UsersRepo {
  count(): number;
  findById(id: string): UserRow | null;
  findByUsername(normalized: string): UserRow | null;
  insert(row: UserRow): void;
  updateVault(id: string, patch: VaultPatch): void;
  setStatus(id: string, status: UserRow['status']): void;
  setRole(id: string, role: UserRow['role']): void;
  /** Oldest first. */
  list(): UserRow[];
  countActiveAdmins(): number;
  /** Erases every escrow copy of a DEK; returns how many there were. */
  clearEscrow(): number;
}

export function createUsersRepo(db: DbHandle, clock: Clock): UsersRepo {
  const toRow = (r: typeof users.$inferSelect): UserRow => ({
    ...r,
    kdfParams: r.kdfParams as Argon2Params,
  });
  return {
    count() {
      const r = db.orm.select({ n: sql<number>`count(*)` }).from(users).get();
      return r?.n ?? 0;
    },
    findById(id) {
      const r = db.orm.select().from(users).where(eq(users.id, id)).get();
      return r ? toRow(r) : null;
    },
    findByUsername(normalized) {
      const r = db.orm.select().from(users).where(eq(users.username, normalized)).get();
      return r ? toRow(r) : null;
    },
    insert(row) {
      db.orm.insert(users).values(row).run();
    },
    updateVault(id, patch) {
      db.orm
        .update(users)
        .set({ ...patch, updatedAt: clock.now() })
        .where(eq(users.id, id))
        .run();
    },
    setStatus(id, status) {
      db.orm.update(users).set({ status, updatedAt: clock.now() }).where(eq(users.id, id)).run();
    },
    setRole(id, role) {
      db.orm.update(users).set({ role, updatedAt: clock.now() }).where(eq(users.id, id)).run();
    },
    list() {
      return db.orm
        .select()
        .from(users)
        .orderBy(asc(users.createdAt), asc(users.username))
        .all()
        .map(toRow);
    },
    countActiveAdmins() {
      const r = db.orm
        .select({ n: sql<number>`count(*)` })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.status, 'active')))
        .get();
      return r?.n ?? 0;
    },
    clearEscrow() {
      return db.orm
        .update(users)
        .set({ dekByInstance: null, updatedAt: clock.now() })
        .where(isNotNull(users.dekByInstance))
        .run().changes;
    },
  };
}
