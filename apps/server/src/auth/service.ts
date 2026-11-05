import {
  type ChangePasswordBody,
  type InstanceInfo,
  type LoginBody,
  newId,
  type PublicUser,
  type RecoverBody,
  type RotateRecoveryKeyBody,
  type SetupBody,
} from '@neotext/shared';
import type { AuditLog } from '../audit/audit';
import type { AppConfig } from '../config/env';
import { argon2Params } from '../crypto/kdf';
import {
  createVault,
  dummyPasswordWork,
  unlockWithPassword,
  unlockWithRecovery,
  wrapForPassword,
  wrapForRecovery,
} from '../crypto/vault';
import type { DbHandle } from '../db/client';
import type { AuthContext } from '../http/env';
import { AppError } from '../http/errors';
import { effectiveRegistration, type InstanceMetaRepo } from '../instance/meta';
import type { Clock } from '../lib/clock';
import { escrowOnSignIn } from './escrow';
import type { SessionStore } from './sessions';
import {
  normalizeUsername,
  validateDisplayName,
  validatePassword,
  validateUsername,
} from './username';
import type { UserRow, UsersRepo } from './users-repo';

export interface AuthService {
  setup(
    input: SetupBody,
    userAgent: string | null,
  ): Promise<{ user: PublicUser; token: string; expiresAt: number; recoveryKey: string }>;
  login(
    input: LoginBody,
    userAgent: string | null,
  ): Promise<{ user: PublicUser; token: string; expiresAt: number }>;
  logout(sessionId: string, userId: string): void;
  changePassword(auth: AuthContext, input: ChangePasswordBody): Promise<void>;
  recover(
    input: RecoverBody,
    userAgent: string | null,
  ): Promise<{ user: PublicUser; token: string; expiresAt: number; recoveryKey: string }>;
  rotateRecoveryKey(
    auth: AuthContext,
    input: RotateRecoveryKeyBody,
  ): Promise<{ recoveryKey: string }>;
  getPublicUser(userId: string): PublicUser | null;
  instanceInfo(): InstanceInfo;
}

export interface AuthServiceDeps {
  db: DbHandle;
  users: UsersRepo;
  sessions: SessionStore;
  instance: InstanceMetaRepo;
  audit: AuditLog;
  config: AppConfig;
  clock: Clock;
  /** Seals the escrow copy of a DEK when escrow is on. */
  instanceKey: Buffer;
}

const invalidCredentials = () =>
  new AppError('invalid_credentials', 'Username or password is incorrect.', 401);
const invalidRecoveryKey = () =>
  new AppError('invalid_recovery_key', "That recovery key doesn't match this account.", 400);

function toPublic(u: UserRow): PublicUser {
  return { id: u.id, username: u.username, displayName: u.displayName, role: u.role };
}

const sameBytes = (a: Buffer, b: Buffer) => a.equals(b);

function requireValid(message: string | null): void {
  if (message) throw new AppError('validation_failed', message, 400);
}

export function createAuthService(deps: AuthServiceDeps): AuthService {
  const { db, users, sessions, instance, audit, config, clock, instanceKey } = deps;
  const params = () => argon2Params(config.argon2);
  /** Re-reads the user inside a transaction; null when the credentials changed since `seen`. */
  const stillCurrent = (seen: UserRow, fields: ('authVerifier' | 'dekByRecovery')[]) => {
    const now = users.findById(seen.id);
    if (!now || !fields.every((f) => sameBytes(now[f], seen[f]))) return null;
    return now;
  };
  const conflict = () =>
    new AppError(
      'conflict',
      'Your account changed while this request was running. Try again.',
      409,
    );
  const disabled = () =>
    new AppError('account_disabled', 'This account is disabled. Ask the admin to enable it.', 403);
  const sessionEnded = () =>
    new AppError('unauthorized', 'Your session has ended. Sign in again.', 401);
  const alreadySetup = () =>
    new AppError('already_setup', 'NeoText is already set up. Sign in instead.', 409);

  return {
    async setup(input, userAgent) {
      const username = normalizeUsername(input.username);
      requireValid(validateUsername(username));
      requireValid(validatePassword(input.password));
      requireValid(validateDisplayName(input.displayName));
      if (users.count() > 0) throw alreadySetup();
      const id = newId('usr');
      const vault = await createVault(id, input.password, params());
      const now = clock.now();
      const row: UserRow = {
        id,
        username,
        displayName: input.displayName?.trim() || username,
        role: 'admin',
        status: 'active',
        kdfSalt: vault.password.kdfSalt,
        kdfParams: vault.password.kdfParams,
        authVerifier: vault.password.authVerifier,
        dekByPassword: vault.password.dekByPassword,
        dekByRecovery: vault.dekByRecovery,
        dekByInstance: null,
        createdAt: now,
        updatedAt: now,
        passwordChangedAt: now,
      };
      db.raw.transaction(() => {
        if (users.count() > 0) throw alreadySetup();
        users.insert(row);
        instance.set('mode', input.mode);
        instance.set('registration', input.mode === 'personal' ? 'closed' : 'invite');
        instance.set('escrow', false);
        instance.set('setup_completed_at', now);
        audit.record('auth.setup', id);
      })();
      const session = sessions.create(id, vault.dek, userAgent);
      return {
        user: toPublic(row),
        token: session.token,
        expiresAt: session.expiresAt,
        recoveryKey: vault.recoveryKey,
      };
    },

    async login(input, userAgent) {
      const user = users.findByUsername(normalizeUsername(input.username));
      if (!user) {
        await dummyPasswordWork(params());
        throw invalidCredentials();
      }
      const dek = await unlockWithPassword(user.id, user, input.password);
      if (!dek) {
        audit.record('auth.login.failure', user.id);
        throw invalidCredentials();
      }
      // Synchronous from here on: nothing can change the credentials before the session exists.
      const current = stillCurrent(user, ['authVerifier']);
      if (!current) throw invalidCredentials();
      if (current.status === 'disabled') throw disabled();
      escrowOnSignIn({ users, instance, instanceKey }, current, dek);
      const session = sessions.create(user.id, dek, userAgent);
      audit.record('auth.login.success', user.id);
      return { user: toPublic(current), token: session.token, expiresAt: session.expiresAt };
    },

    logout(sessionId, userId) {
      sessions.revoke(sessionId);
      audit.record('auth.logout', userId);
    },

    async changePassword(auth, input) {
      const user = users.findById(auth.userId);
      if (!user) throw invalidCredentials();
      const dek = await unlockWithPassword(user.id, user, input.currentPassword);
      if (!dek) throw invalidCredentials();
      requireValid(validatePassword(input.newPassword));
      const wrap = await wrapForPassword(user.id, dek, input.newPassword, params());
      db.raw.transaction(() => {
        if (!stillCurrent(user, ['authVerifier'])) throw invalidCredentials();
        if (!sessions.listForUser(user.id).some((x) => x.id === auth.sessionId)) {
          throw sessionEnded();
        }
        users.updateVault(user.id, { ...wrap, passwordChangedAt: clock.now() });
        sessions.revokeAllForUser(user.id, auth.sessionId);
        audit.record('auth.password.changed', user.id);
      })();
    },

    async recover(input, userAgent) {
      requireValid(validatePassword(input.newPassword));
      const user = users.findByUsername(normalizeUsername(input.username));
      if (!user) throw invalidRecoveryKey();
      const dek = unlockWithRecovery(user.id, user.dekByRecovery, input.recoveryKey);
      if (!dek) throw invalidRecoveryKey();
      if (user.status === 'disabled') throw disabled();
      const wrap = await wrapForPassword(user.id, dek, input.newPassword, params());
      const recovery = wrapForRecovery(user.id, dek);
      const session = db.raw.transaction(() => {
        const current = stillCurrent(user, ['dekByRecovery', 'authVerifier']);
        if (!current) throw invalidRecoveryKey();
        if (current.status === 'disabled') throw disabled();
        users.updateVault(user.id, {
          ...wrap,
          dekByRecovery: recovery.dekByRecovery,
          passwordChangedAt: clock.now(),
        });
        sessions.revokeAllForUser(user.id);
        escrowOnSignIn({ users, instance, instanceKey }, current, dek);
        audit.record('auth.recovery.used', user.id);
        return sessions.create(user.id, dek, userAgent);
      })();
      return {
        user: toPublic(user),
        token: session.token,
        expiresAt: session.expiresAt,
        recoveryKey: recovery.recoveryKey,
      };
    },

    async rotateRecoveryKey(auth, input) {
      const user = users.findById(auth.userId);
      if (!user) throw invalidCredentials();
      const dek = await unlockWithPassword(user.id, user, input.password);
      if (!dek) throw invalidCredentials();
      const recovery = wrapForRecovery(user.id, dek);
      db.raw.transaction(() => {
        if (!stillCurrent(user, ['authVerifier', 'dekByRecovery'])) throw conflict();
        if (!sessions.listForUser(user.id).some((x) => x.id === auth.sessionId)) {
          throw sessionEnded();
        }
        users.updateVault(user.id, { dekByRecovery: recovery.dekByRecovery });
        audit.record('auth.recovery.rotated', user.id);
      })();
      return { recoveryKey: recovery.recoveryKey };
    },

    getPublicUser(userId) {
      const user = users.findById(userId);
      return user ? toPublic(user) : null;
    },

    instanceInfo() {
      const setupRequired = users.count() === 0;
      return {
        setupRequired,
        mode: instance.get('mode'),
        registration: effectiveRegistration(instance),
        version: config.version,
        envProviderAvailable: config.openrouterApiKey !== null,
        escrow: instance.get('escrow') === true,
      };
    },
  };
}
