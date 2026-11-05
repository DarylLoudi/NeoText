import { describe, expect, test } from 'vitest';
import { isId, newId } from './ids';

describe('ids', () => {
  test('newId has the prefix and a 26-char ULID', () => {
    expect(newId('cnv')).toMatch(/^cnv_[0-9A-HJKMNP-TV-Z]{26}$/);
  });
  test('newId sorts in creation order within one millisecond', () => {
    const ids = Array.from({ length: 50 }, () => newId('msg'));
    expect([...ids].sort()).toEqual(ids);
  });
  test('isId checks prefix and shape', () => {
    expect(isId(newId('usr'), 'usr')).toBe(true);
    expect(isId(newId('usr'), 'cnv')).toBe(false);
    expect(isId('usr_123', 'usr')).toBe(false);
    expect(isId(42, 'usr')).toBe(false);
  });
});
