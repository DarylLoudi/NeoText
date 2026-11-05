import { randomBytes } from 'node:crypto';
import type {
  AdminInstance,
  AdminUser,
  ResetPasswordResponse,
  UpdateAdminInstanceBody,
  UpdateAdminUserBody,
} from '@neotext/shared';
import type { AuditLog } from '../audit/audit';
import type { SessionStore } from '../auth/sessions';
import type { UserRow, UsersRepo } from '../auth/users-repo';
import type { GenerationManager } from '../chat/generation/manager';
import type { AppConfig } from '../config/env';
import { argon2Params } from '../crypto/kdf';
import { CROCKFORD_ALPHABET } from '../crypto/recovery-key';
import { unwrapForInstance, wrapForPassword } from '../crypto/vault';
import type { DbHandle } from '../db/client';
import type { AuthContext } from '../http/env';
import { AppError } from '../http/errors';
import { effectiveRegistration, type InstanceMetaRepo } from '../instance/meta';
import type { Clock } from '../lib/clock';
import { costByUser } from '../usage/summary';

/**
 * What an admin can do to other accounts. There is no account deletion: any future delete must
 * also call `attachments.removeUserFiles(userId)`, or the user's sealed files stay on disk.
 */
export interface AdminService {
  users(): AdminUser[];
  updateUser(actor: AuthContext, id: string, body: UpdateAdminUserBody): AdminUser;
  resetPassword(actor: AuthContext, id: string): Promise<ResetPasswordResponse>;
  instance(): AdminInstance;
  updateInstance(actor: AuthContext, body: UpdateAdminInstanceBody): AdminInstance;
}

export interface AdminServiceDeps {
  db: DbHandle;
  users: UsersRepo;
  sessions: SessionStore;
  instance: InstanceMetaRepo;
  generations: GenerationManager;
  audit: AuditLog;
  config: AppConfig;
  clock: Clock;
  instanceKey: Buffer;
}

const TEMP_PASSWORD_CHARS = 16; // 80 random bits, 5 per character

/** 16 characters of the Crockford alphabet: no I, L, O or U to misread when it is passed on. */
export function generateTemporaryPassword(): string {
  const bytes = randomBytes(TEMP_PASSWORD_CHARS);
  let out = '';
  for (const b of bytes) out += CROCKFORD_ALPHABET[b & 31];
  return out;
}

const notFound = () => new AppError('not_found', 'That user does not exist.', 404);
const lastAdmin = () =>
  new AppError('conflict', 'NeoText needs at least one active admin.', 409, {
    reason: 'last_admin',
  });
const noEscrow = () =>
  new AppError(
    'conflict',
    "This account can't be reset without losing its chats. The user can reset it with their recovery key.",
    409,
    { reason: 'no_escrow' },
  );
const personalSignUps = () =>
  new AppError(
    'conflict',
    'A personal NeoText takes no sign-ups. Switch to community mode first.',
    409,
    { reason: 'personal_signups' },
  );
const changed = () =>
  new AppError('conflict', 'This account changed while the reset was running. Try again.', 409);

/** `[start, end)` of `now`'s UTC month. */
function utcMonth(now: number): [number, number] {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return [Date.UTC(y, m, 1), Date.UTC(y, m + 1, 1)];
}

export function createAdminService(deps: AdminServiceDeps): AdminService {
  const { db, users, sessions, instance, generations, audit, config, clock, instanceKey } = deps;

  const toAdmin = (
    u: UserRow,
    lastSeen: Map<string, number>,
    costs: Map<string, number>,
  ): AdminUser => ({
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt,
    lastSeenAt: lastSeen.get(u.id) ?? null,
    monthCostUsd: costs.get(u.id) ?? 0,
  });
  const monthCosts = () => costByUser(db, ...utcMonth(clock.now()));
  const one = (u: UserRow) => toAdmin(u, sessions.lastSeenByUser(), monthCosts());
  const current = (): AdminInstance => ({
    mode: instance.get('mode') ?? 'personal',
    registration: effectiveRegistration(instance) ?? 'closed',
    escrow: instance.get('escrow') === true,
    defaultQuota: instance.get('default_quota') ?? null,
  });

  return {
    users() {
      const lastSeen = sessions.lastSeenByUser();
      const costs = monthCosts();
      return users.list().map((u) => toAdmin(u, lastSeen, costs));
    },

    updateUser(actor, id, body) {
      const updated = db.raw.transaction(() => {
        const user = users.findById(id);
        if (!user) throw notFound();
        if (body.role && body.role !== user.role) users.setRole(id, body.role);
        if (body.status && body.status !== user.status) users.setStatus(id, body.status);
        // Counted after the write, in the same transaction: two demotions cannot both pass.
        if (users.countActiveAdmins() === 0) throw lastAdmin();
        if (body.status === 'disabled' && user.status !== 'disabled') {
          sessions.revokeAllForUser(id);
        }
        const meta: Record<string, string> = { targetId: id };
        if (body.role && body.role !== user.role) meta.role = body.role;
        if (body.status && body.status !== user.status) meta.status = body.status;
        if (Object.keys(meta).length > 1) audit.record('admin.user.updated', actor.userId, meta);
        return users.findById(id) as UserRow;
      })();
      // After the commit: a rolled-back disable must not stop anything.
      if (updated.status === 'disabled') generations.abortAllForUser(id);
      return one(updated);
    },

    async resetPassword(actor, id) {
      const user = users.findById(id);
      if (!user) throw notFound();
      if (instance.get('escrow') !== true || !user.dekByInstance) throw noEscrow();
      const dek = unwrapForInstance(user.id, user.dekByInstance, instanceKey);
      if (!dek) throw noEscrow();
      const temporaryPassword = generateTemporaryPassword();
      const wrap = await wrapForPassword(
        user.id,
        dek,
        temporaryPassword,
        argon2Params(config.argon2),
      );
      db.raw.transaction(() => {
        const now = users.findById(id);
        if (!now || !now.authVerifier.equals(user.authVerifier)) throw changed();
        // Escrow may have been turned off while the password key was derived.
        if (instance.get('escrow') !== true || !now.dekByInstance) throw noEscrow();
        users.updateVault(id, { ...wrap, passwordChangedAt: clock.now() });
        sessions.revokeAllForUser(id);
        audit.record('admin.password.reset', actor.userId, { targetId: id });
      })();
      return { temporaryPassword };
    },

    instance: current,

    updateInstance(actor, body) {
      db.raw.transaction(() => {
        const before = current();
        const meta: Record<string, string | boolean | number | null> = {};
        const mode = body.mode ?? before.mode;
        // Personal means just the owner, as at setup: sign-ups close with it.
        let registration = body.registration ?? before.registration;
        if (mode === 'personal') {
          if (registration !== 'closed' && body.registration !== undefined) {
            throw personalSignUps();
          }
          registration = 'closed';
        }
        if (mode !== before.mode) {
          instance.set('mode', mode);
          meta.mode = mode;
        }
        if (registration !== instance.get('registration')) {
          instance.set('registration', registration);
        }
        if (registration !== before.registration) meta.registration = registration;
        // Off means no copy of any key stays behind under the instance key, every time.
        if (body.escrow === false) users.clearEscrow();
        if (body.escrow !== undefined && body.escrow !== before.escrow) {
          instance.set('escrow', body.escrow);
          meta.escrow = body.escrow;
        }
        if (body.defaultQuota !== undefined) {
          const next = body.defaultQuota;
          const prev = before.defaultQuota;
          if (next?.dailyUsd !== prev?.dailyUsd || next?.monthlyUsd !== prev?.monthlyUsd) {
            instance.set('default_quota', next);
            meta.defaultDailyUsd = next?.dailyUsd ?? null;
            meta.defaultMonthlyUsd = next?.monthlyUsd ?? null;
          }
        }
        if (Object.keys(meta).length > 0)
          audit.record('admin.instance.updated', actor.userId, meta);
      })();
      return current();
    },
  };
}
