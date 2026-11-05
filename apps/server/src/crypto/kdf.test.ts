import { argon2Sync } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import {
  type Argon2Params,
  argon2Params,
  deriveIkm,
  hkdf,
  randomKey,
  randomSalt,
  sha256,
} from './kdf';

const params: Argon2Params = { alg: 'argon2id', memoryKiB: 1024, passes: 1, parallelism: 1, v: 1 };

describe('kdf', () => {
  test('deterministic per salt, different across salts', async () => {
    const salt = randomSalt();
    const a = await deriveIkm('pw', salt, params);
    expect(a.length).toBe(32);
    expect(a.equals(await deriveIkm('pw', salt, params))).toBe(true);
    expect(a.equals(await deriveIkm('pw', randomSalt(), params))).toBe(false);
  });

  test('NFKC normalizes the password', async () => {
    const salt = randomSalt();
    const composed = await deriveIkm('café', salt, params);
    const decomposed = await deriveIkm('café', salt, params);
    expect(composed.equals(decomposed)).toBe(true);
  });

  test('hkdf separates purposes', () => {
    const ikm = randomKey();
    expect(hkdf(ikm, 'neotext/auth/v1').equals(hkdf(ikm, 'neotext/kek/v1'))).toBe(false);
    expect(hkdf(ikm, 'x', 16).length).toBe(16);
  });

  test('helpers', () => {
    expect(randomKey().length).toBe(32);
    expect(randomSalt().length).toBe(16);
    expect(sha256('abc').toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(argon2Params({ memoryKiB: 1024, passes: 1 })).toEqual(params);
  });

  test('queues more than two concurrent derivations', async () => {
    const salt = randomSalt();
    const runs = await Promise.all([1, 2, 3, 4].map((i) => deriveIkm(`pw${i}`, salt, params)));
    expect(new Set(runs.map((r) => r.toString('hex'))).size).toBe(4);
  });
});

describe('known answers', () => {
  test('RFC 9106 section 5.3 argon2id vector (validates the underlying primitive)', () => {
    const tag = argon2Sync('argon2id', {
      message: Buffer.alloc(32, 0x01),
      nonce: Buffer.alloc(16, 0x02),
      secret: Buffer.alloc(8, 0x03),
      associatedData: Buffer.alloc(12, 0x04),
      parallelism: 4,
      tagLength: 32,
      memory: 32,
      passes: 3,
    });
    expect(Buffer.from(tag).toString('hex')).toBe(
      '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659',
    );
  });

  test('RFC 5869 test case 3 (empty salt, empty info) through hkdf', () => {
    const okm = hkdf(Buffer.alloc(22, 0x0b), '', 42);
    expect(okm.toString('hex')).toBe(
      '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8',
    );
  });

  // Regression vector pinned from the current code; the RFC 9106 test above validates the primitive.
  test('deriveIkm output is pinned for a non-ASCII password', async () => {
    const ikm = await deriveIkm('pässword', Buffer.alloc(16, 7), params);
    expect(ikm.toString('hex')).toBe(
      '86a1f9eb8156919fd0a5aa2dd0080ec3bde133c741ebe85613e97e8a81b538b5',
    );
  });
});
