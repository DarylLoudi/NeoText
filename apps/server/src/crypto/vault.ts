import { timingSafeEqual } from 'node:crypto';
import { aad } from './aad';
import { DecryptError, open, seal } from './aead';
import { type Argon2Params, deriveIkm, hkdf, randomKey, randomSalt, sha256 } from './kdf';
import { encodeRecoveryKey, parseRecoveryKey } from './recovery-key';

export interface PasswordWrap {
  kdfSalt: Buffer;
  kdfParams: Argon2Params;
  authVerifier: Buffer;
  dekByPassword: Buffer;
}

const DUMMY_SALT = Buffer.alloc(16, 0x5a);

/** Opens a sealed DEK; a wrong secret or tampered data yields null, never an exception. */
function tryOpen(key: Buffer, sealed: Buffer, aadString: string): Buffer | null {
  try {
    return open(key, sealed, aadString);
  } catch (err) {
    if (err instanceof DecryptError) return null;
    throw err;
  }
}

export async function wrapForPassword(
  userId: string,
  dek: Buffer,
  password: string,
  params: Argon2Params,
): Promise<PasswordWrap> {
  const kdfSalt = randomSalt();
  const ikm = await deriveIkm(password, kdfSalt, params);
  const authVerifier = sha256(hkdf(ikm, 'neotext/auth/v1'));
  const dekByPassword = seal(
    hkdf(ikm, 'neotext/kek/v1'),
    dek,
    aad('users', 'dek_by_password', userId),
  );
  return { kdfSalt, kdfParams: params, authVerifier, dekByPassword };
}

export async function unlockWithPassword(
  userId: string,
  wrap: PasswordWrap,
  password: string,
): Promise<Buffer | null> {
  const ikm = await deriveIkm(password, wrap.kdfSalt, wrap.kdfParams);
  const verifier = sha256(hkdf(ikm, 'neotext/auth/v1'));
  if (verifier.length !== wrap.authVerifier.length || !timingSafeEqual(verifier, wrap.authVerifier))
    return null;
  return tryOpen(
    hkdf(ikm, 'neotext/kek/v1'),
    wrap.dekByPassword,
    aad('users', 'dek_by_password', userId),
  );
}

export function wrapForRecovery(
  userId: string,
  dek: Buffer,
): { dekByRecovery: Buffer; recoveryKey: string } {
  const bytes = randomKey();
  const dekByRecovery = seal(
    hkdf(bytes, 'neotext/recovery/v1'),
    dek,
    aad('users', 'dek_by_recovery', userId),
  );
  return { dekByRecovery, recoveryKey: encodeRecoveryKey(bytes) };
}

export function unlockWithRecovery(
  userId: string,
  dekByRecovery: Buffer,
  recoveryKey: string,
): Buffer | null {
  const bytes = parseRecoveryKey(recoveryKey);
  if (!bytes) return null;
  return tryOpen(
    hkdf(bytes, 'neotext/recovery/v1'),
    dekByRecovery,
    aad('users', 'dek_by_recovery', userId),
  );
}

export function wrapForSession(sessionId: string, token: string, dek: Buffer): Buffer {
  return seal(
    hkdf(Buffer.from(token), 'neotext/session/v1'),
    dek,
    aad('sessions', 'dek', sessionId),
  );
}

export function unwrapForSession(sessionId: string, token: string, wrapped: Buffer): Buffer | null {
  return tryOpen(
    hkdf(Buffer.from(token), 'neotext/session/v1'),
    wrapped,
    aad('sessions', 'dek', sessionId),
  );
}

/** Password escrow: the DEK sealed under the instance key, so an admin can reset the password. */
export function wrapForInstance(userId: string, dek: Buffer, instanceKey: Buffer): Buffer {
  return seal(instanceKey, dek, aad('users', 'dek_by_instance', userId));
}

export function unwrapForInstance(
  userId: string,
  dekByInstance: Buffer,
  instanceKey: Buffer,
): Buffer | null {
  return tryOpen(instanceKey, dekByInstance, aad('users', 'dek_by_instance', userId));
}

/** One Argon2 run on a fixed salt, so unknown-user logins cost the same as real ones. */
export async function dummyPasswordWork(params: Argon2Params): Promise<void> {
  await deriveIkm('neotext-dummy-password', DUMMY_SALT, params);
}

export async function createVault(
  userId: string,
  password: string,
  params: Argon2Params,
): Promise<{ dek: Buffer; password: PasswordWrap; dekByRecovery: Buffer; recoveryKey: string }> {
  const dek = randomKey();
  const wrap = await wrapForPassword(userId, dek, password, params);
  const recovery = wrapForRecovery(userId, dek);
  return { dek, password: wrap, ...recovery };
}
