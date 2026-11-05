import { describe, expect, test } from 'vitest';
import { normalizeUsername, validatePassword, validateUsername } from './username';

describe('username', () => {
  test.each([
    [' Daryl ', 'daryl'],
    ['ＤＡＲＹＬ', 'daryl'],
  ])('normalize %s', (input, expected) => {
    expect(normalizeUsername(input)).toBe(expected);
  });

  test('validation messages', () => {
    const msg = 'Use 3–32 letters, digits, dots, dashes or underscores.';
    expect(validateUsername('ab')).toBe(msg);
    expect(validateUsername('a'.repeat(33))).toBe(msg);
    expect(validateUsername('-daryl')).toBe(msg);
    expect(validateUsername('daryl.l-4')).toBeNull();
    expect(validatePassword('123456789')).not.toBeNull();
    expect(validatePassword('1234567890')).toBeNull();
    expect(validatePassword('a'.repeat(1025))).not.toBeNull();
    expect(validatePassword('a'.repeat(1024))).toBeNull();
  });
});
