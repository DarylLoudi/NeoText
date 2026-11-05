import { argon2, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import type { AppConfig } from '../config/env';
import { createSemaphore } from '../lib/semaphore';

const argon2Async = promisify(argon2);
const limitArgon2 = createSemaphore(2);

export interface Argon2Params {
  alg: 'argon2id';
  memoryKiB: number;
  passes: number;
  parallelism: 1;
  v: 1;
}

export function argon2Params(cfg: AppConfig['argon2']): Argon2Params {
  return {
    alg: 'argon2id',
    memoryKiB: cfg.memoryKiB,
    passes: cfg.passes,
    parallelism: 1,
    v: 1,
  };
}

/** Password to 32 bytes of input keying material. At most two runs execute at once. */
export function deriveIkm(password: string, salt: Buffer, params: Argon2Params): Promise<Buffer> {
  return limitArgon2(async () =>
    Buffer.from(
      await argon2Async('argon2id', {
        message: Buffer.from(password.normalize('NFKC'), 'utf8'),
        nonce: salt,
        parallelism: params.parallelism,
        tagLength: 32,
        memory: params.memoryKiB,
        passes: params.passes,
      }),
    ),
  );
}

export function hkdf(ikm: Buffer, info: string, length = 32): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, Buffer.alloc(0), info, length));
}

export function sha256(data: Buffer | string): Buffer {
  return createHash('sha256').update(data).digest();
}

export function randomKey(): Buffer {
  return randomBytes(32);
}

export function randomSalt(): Buffer {
  return randomBytes(16);
}
