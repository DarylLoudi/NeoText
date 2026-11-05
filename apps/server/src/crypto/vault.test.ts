import { describe, expect, it } from 'vitest';
import type { Argon2Params } from './kdf';
import {
  createVault,
  unlockWithPassword,
  unlockWithRecovery,
  unwrapForSession,
  wrapForPassword,
  wrapForSession,
} from './vault';

const params: Argon2Params = {
  alg: 'argon2id',
  memoryKiB: 1024,
  passes: 1,
  parallelism: 1,
  v: 1,
};

describe('vault', () => {
  it('password unlocks the same DEK', async () => {
    const v = await createVault('usr_A', 'correct horse', params);
    const dek = await unlockWithPassword('usr_A', v.password, 'correct horse');
    expect(dek?.equals(v.dek)).toBe(true);
  });

  it('wrong password returns null', async () => {
    const v = await createVault('usr_A', 'correct horse', params);
    expect(await unlockWithPassword('usr_A', v.password, 'wrong')).toBeNull();
  });

  it('recovery key unlocks', async () => {
    const v = await createVault('usr_A', 'pw', params);
    expect(unlockWithRecovery('usr_A', v.dekByRecovery, v.recoveryKey)?.equals(v.dek)).toBe(true);
    expect(unlockWithRecovery('usr_A', v.dekByRecovery, 'NTXR-nonsense')).toBeNull();
  });

  it('rewrapping keeps the DEK and retires the old password', async () => {
    const v = await createVault('usr_A', 'old pw', params);
    const next = await wrapForPassword('usr_A', v.dek, 'new pw', params);
    expect(next.kdfSalt.equals(v.password.kdfSalt)).toBe(false);
    expect((await unlockWithPassword('usr_A', next, 'new pw'))?.equals(v.dek)).toBe(true);
    expect(await unlockWithPassword('usr_A', next, 'old pw')).toBeNull();
  });

  it('session wrap round trip and wrong token fails', () => {
    const dek = Buffer.alloc(32, 7);
    const wrapped = wrapForSession('ses_1', 'token-a', dek);
    expect(unwrapForSession('ses_1', 'token-a', wrapped)?.equals(dek)).toBe(true);
    expect(unwrapForSession('ses_1', 'token-b', wrapped)).toBeNull();
    expect(unwrapForSession('ses_2', 'token-a', wrapped)).toBeNull();
  });

  it('a wrap for user A cannot be opened as user B', async () => {
    const v = await createVault('usr_A', 'pw', params);
    expect(await unlockWithPassword('usr_B', v.password, 'pw')).toBeNull();
  });
});

describe('envelope format', () => {
  it('a fixed session envelope from this format version still opens', () => {
    // Produced once by wrapForSession('ses_fixed', 'tok_fixed', Buffer.alloc(32, 9)).
    const fixed = Buffer.from(
      '016bf31f495bbca931a6c9855cb3ad83780c0a0cb159c9b75000b3f8800fe17483b8197ee02d9cd49cce90220e665dacfa3de1f75f3f156198834e191d',
      'hex',
    );
    expect(unwrapForSession('ses_fixed', 'tok_fixed', fixed)?.equals(Buffer.alloc(32, 9))).toBe(
      true,
    );
    expect(unwrapForSession('ses_other', 'tok_fixed', fixed)).toBeNull();
    expect(unwrapForSession('ses_fixed', 'tok_other', fixed)).toBeNull();
  });
});
