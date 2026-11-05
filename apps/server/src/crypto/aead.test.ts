import { describe, expect, test } from 'vitest';
import { aad } from './aad';
import { DecryptError, open, openJson, openText, seal, sealJson, sealText } from './aead';
import { randomKey } from './kdf';

const key = randomKey();

describe('aead', () => {
  test('round trip and envelope layout', () => {
    const sealed = seal(key, Buffer.from('halo dunia'), 'neotext/v1/t/c/1');
    expect(sealed[0]).toBe(1);
    expect(sealed.length).toBe(1 + 12 + 10 + 16);
    expect(open(key, sealed, 'neotext/v1/t/c/1').toString()).toBe('halo dunia');
  });

  test('fresh nonce each time', () => {
    expect(seal(key, Buffer.from('x'), 'a').equals(seal(key, Buffer.from('x'), 'a'))).toBe(false);
  });

  test.each(['tamper', 'wrong aad', 'wrong key', 'bad version', 'truncated'])(
    '%s throws DecryptError',
    (kind) => {
      const sealed = seal(key, Buffer.from('secret payload'), 'a');
      let k = key;
      let a = 'a';
      let input = Buffer.from(sealed);
      if (kind === 'tamper') input[20] = (input[20] ?? 0) ^ 0xff;
      if (kind === 'wrong aad') a = 'b';
      if (kind === 'wrong key') k = randomKey();
      if (kind === 'bad version') input[0] = 2;
      if (kind === 'truncated') input = input.subarray(0, 20);
      expect(() => open(k, input, a)).toThrow(DecryptError);
    },
  );

  test('json and text helpers', () => {
    expect(openJson(key, sealJson(key, { a: [1] }, 'x'), 'x')).toEqual({ a: [1] });
    expect(openText(key, sealText(key, 'héllo', 'x'), 'x')).toBe('héllo');
  });

  test('aad builds the row-binding string', () => {
    expect(aad('users', 'dek_by_password', 'u1')).toBe('neotext/v1/users/dek_by_password/u1');
  });
});
