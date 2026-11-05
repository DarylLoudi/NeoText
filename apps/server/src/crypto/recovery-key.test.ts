import { describe, expect, test } from 'vitest';
import { randomKey } from './kdf';
import { encodeRecoveryKey, parseRecoveryKey } from './recovery-key';

describe('recovery key', () => {
  test('format', () => {
    expect(encodeRecoveryKey(randomKey())).toMatch(/^NTXR(-[0-9A-HJKMNP-TV-Z]{4}){13}$/);
  });

  test('parse is forgiving', () => {
    const bytes = randomKey();
    const k = encodeRecoveryKey(bytes);
    expect(parseRecoveryKey(k)?.equals(bytes)).toBe(true);
    expect(parseRecoveryKey(k.toLowerCase().replaceAll('-', ' '))?.equals(bytes)).toBe(true);
    expect(parseRecoveryKey(k.replace('NTXR-', ''))?.equals(bytes)).toBe(true);
  });

  test('confusables map to digits', () => {
    const bytes = Buffer.alloc(32, 0);
    bytes[0] = 0x08; // first character is 1, the rest are 0
    const k = encodeRecoveryKey(bytes);
    expect(k).toContain('0');
    expect(k).toContain('1');
    const confused = k.replace(/0/g, 'O').replace(/1/g, 'l');
    expect(parseRecoveryKey(confused)?.equals(bytes)).toBe(true);
    expect(parseRecoveryKey(k.replace(/1/g, 'I'))?.equals(bytes)).toBe(true);
  });

  test('rejects garbage', () => {
    expect(parseRecoveryKey('NTXR-ABCD')).toBeNull();
    expect(parseRecoveryKey(`NTXR-${'U'.repeat(52)}`)).toBeNull();
    expect(parseRecoveryKey('')).toBeNull();
  });

  test('encode requires 32 bytes', () => {
    expect(() => encodeRecoveryKey(Buffer.alloc(5))).toThrow();
  });
});
