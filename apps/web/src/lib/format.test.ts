import { describe, expect, test } from 'vitest';
import {
  dateBucket,
  formatContext,
  formatCost,
  formatDuration,
  formatMonth,
  formatPricePerM,
  formatTime,
  formatTokens,
} from './format';

describe('formatCost', () => {
  test.each([
    [null, ''],
    [0, '$0'],
    [0.00004, '<$0.0001'],
    [0.0004, '$0.0004'],
    [0.00125, '$0.0013'],
    [0.042, '$0.042'],
    [1.5, '$1.50'],
    [123.456, '$123.46'],
  ])('cost %s', (v, s) => expect(formatCost(v)).toBe(s));
  test('uses the Indonesian decimal comma', () => {
    expect(formatCost(1.5, 'id')).toBe('$1,50');
    expect(formatCost(0.00004, 'id')).toBe('<$0,0001');
  });
});

describe('formatPricePerM', () => {
  test.each([
    [0, 'Free'],
    [0.045, '$0.045'],
    [0.5, '$0.50'],
    [15, '$15'],
    [null, '—'],
  ])('price per 1M %s', (v, s) => expect(formatPricePerM(v)).toBe(s));
  test('Indonesian', () => {
    expect(formatPricePerM(0, 'id')).toBe('Gratis');
    expect(formatPricePerM(0.5, 'id')).toBe('$0,50');
  });
});

describe('formatTokens', () => {
  test.each([
    [950, '950'],
    [1234, '1.2k'],
    [3_400_000, '3.4M'],
  ])('tokens %i', (v, s) => expect(formatTokens(v)).toBe(s));
  test('Indonesian decimal comma', () => expect(formatTokens(1234, 'id')).toBe('1,2k'));
});

describe('formatContext', () => {
  test.each([
    [1048576, '1M'],
    [200000, '200k'],
    [null, '—'],
  ])('context %s', (v, s) => expect(formatContext(v)).toBe(s));
});

describe('formatDuration', () => {
  test.each([
    [820, '820 ms'],
    [2100, '2.1 s'],
    [72000, '1 min 12 s'],
  ])('duration %i', (v, s) => expect(formatDuration(v)).toBe(s));
  test('Indonesian', () => expect(formatDuration(2100, 'id')).toBe('2,1 dtk'));
});

describe('dateBucket', () => {
  const now = new Date(2026, 10, 3, 10, 0).getTime();
  const at = (m: number, d: number, h = 12) => new Date(2026, m - 1, d, h).getTime();
  test('today', () => expect(dateBucket(at(11, 3, 0), now)).toEqual({ kind: 'today' }));
  test('yesterday', () => expect(dateBucket(at(11, 2, 23), now)).toEqual({ kind: 'yesterday' }));
  test('previous7', () => expect(dateBucket(at(10, 28), now)).toEqual({ kind: 'previous7' }));
  test('previous30', () => expect(dateBucket(at(10, 10), now)).toEqual({ kind: 'previous30' }));
  test('month', () =>
    expect(dateBucket(at(9, 15), now)).toEqual({ kind: 'month', year: 2026, month: 9 }));
  test('month across years', () =>
    expect(dateBucket(new Date(2025, 11, 31, 8).getTime(), now)).toEqual({
      kind: 'month',
      year: 2025,
      month: 12,
    }));
});

describe('formatMonth and formatTime', () => {
  test('month names follow the locale', () => {
    expect(formatMonth(2026, 9, 'en')).toBe('September 2026');
    expect(formatMonth(2026, 9, 'id')).toBe('September 2026');
    expect(formatMonth(2026, 8, 'id')).toBe('Agustus 2026');
  });
  test('time', () => {
    const ts = new Date(2026, 10, 3, 14, 5).getTime();
    expect(formatTime(ts, 'en')).toMatch(/^2:05\sPM$/);
    expect(formatTime(ts, 'id')).toMatch(/^14[.:]05$/);
  });
});
