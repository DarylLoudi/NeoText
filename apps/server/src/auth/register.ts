import { newId, type PublicUser, type RegisterBody } from '@neotext/shared';
import type { AuditLog } from '../audit/audit';
import type { AppConfig } from '../config/env';
import { argon2Params } from '../crypto/kdf';
import { createVault } from '../crypto/vault';
import type { DbHandle } from '../db/client';
import { AppError } from '../http/errors';
import { effectiveRegistration, type InstanceMetaRepo } from '../instance/meta';
import type { Clock } from '../lib/clock';
import { escrowOnSignIn } from './escrow';
import { hashInviteCode, type InvitesRepo } from './invites';
import type { SessionStore } from './sessions';
import {
  normalizeUsername,
  validateDisplayName,
  validatePassword,
  validateUsername,
} from './username';
import type { UserRow, UsersRepo } from './users-repo';

export interface RegisterDeps {
  db: DbHandle;
  users: UsersRepo;
  sessions: SessionStore;
  instance: InstanceMetaRepo;
  invites: InvitesRepo;
  audit: AuditLog;
  config: AppConfig;
  clock: Clock;
  instanceKey: Buffer;
}

export interface Registered {
  user: PublicUser;
  token: string;
  expiresAt: number;
  recoveryKey: string;
}

const closed = () =>
  new AppError('forbidden', 'Sign-ups are closed. Ask the admin for access.', 403, {
    reason: 'closed',
  });
// One message for a missing, wrong, expired, used or revoked code: no hint which it was.
const badCode = () =>
  new AppError('forbidden', 'That invite code is not valid.', 403, { reason: 'invite_invalid' });
const taken = () =>
  new AppError('conflict', 'That username is taken.', 409, { reason: 'username_taken' });

/** Same shape as a schema failure, so the form shows the message on the field. */
function requireValid(
  message: string | null,
  field: 'username' | 'password' | 'displayName',
): void {
  if (message) throw new AppError('validation_failed', message, 400, [{ path: [field], message }]);
}

const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' &&
  err !== null &&
  (err as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE';

/**
 * Creates a member (or the invite's role) when the instance allows sign-ups. The slow vault
 * derivation runs first; one transaction then inserts the user and spends the invite, so a
 * code that lost a race rolls the new user back.
 */
export async function register(
  deps: RegisterDeps,
  input: RegisterBody,
  userAgent: string | null,
): Promise<Registered> {
  const { db, users, sessions, instance, invites, audit, config, clock, instanceKey } = deps;
  const policy = effectiveRegistration(instance) ?? 'closed';
  if (policy === 'closed' || users.count() === 0) throw closed();

  const username = normalizeUsername(input.username);
  requireValid(validateUsername(username), 'username');
  requireValid(validatePassword(input.password), 'password');
  requireValid(validateDisplayName(input.displayName), 'displayName');

  let invite: { id: string; role: 'admin' | 'member' } | null = null;
  if (policy === 'invite') {
    const found = input.inviteCode
      ? invites.findByHash(hashInviteCode(instanceKey, input.inviteCode))
      : null;
    if (!found || found.usedAt !== null || found.expiresAt <= clock.now()) throw badCode();
    invite = { id: found.id, role: found.role };
  }
  if (users.findByUsername(username)) throw taken();

  const id = newId('usr');
  const vault = await createVault(id, input.password, argon2Params(config.argon2));
  const now = clock.now();
  const row: UserRow = {
    id,
    username,
    displayName: input.displayName?.trim() || username,
    role: invite?.role ?? 'member',
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
  try {
    db.raw.transaction(() => {
      if (users.findByUsername(username)) throw taken();
      users.insert(row);
      if (invite && !invites.consume(invite.id, id, clock.now())) throw badCode();
      escrowOnSignIn({ users, instance, instanceKey }, row, vault.dek);
      audit.record('auth.registered', id, { role: row.role, via: invite ? 'invite' : 'open' });
    })();
  } catch (err) {
    if (isUniqueViolation(err)) throw taken();
    throw err;
  }
  const session = sessions.create(id, vault.dek, userAgent);
  return {
    user: { id, username, displayName: row.displayName, role: row.role },
    token: session.token,
    expiresAt: session.expiresAt,
    recoveryKey: vault.recoveryKey,
  };
}
