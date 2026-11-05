import { describe, expect, test } from 'vitest';
import en from './locales/en.json';
import id from './locales/id.json';
import { flatEntries, interpolationVars } from './parity';

const enEntries = flatEntries(en);
const idEntries = flatEntries(id);

describe('locale parity', () => {
  test('en and id have the same keys', () => {
    expect(Object.keys(idEntries).sort()).toEqual(Object.keys(enEntries).sort());
  });

  test('no empty translations', () => {
    for (const [key, v] of [...Object.entries(enEntries), ...Object.entries(idEntries)]) {
      expect(v.trim(), key).not.toBe('');
    }
  });

  test('interpolation variables match per key', () => {
    for (const [key, v] of Object.entries(enEntries)) {
      expect(interpolationVars(idEntries[key] ?? ''), key).toEqual(interpolationVars(v));
    }
  });

  test('every top-level group is one of the agreed features', () => {
    expect(Object.keys(en).sort()).toEqual(
      ['admin', 'auth', 'chat', 'common', 'settings', 'shell', 'sidebar'].sort(),
    );
  });
});

describe('parity helpers detect drift', () => {
  test('flatEntries flattens nested keys with dots', () => {
    expect(flatEntries({ a: { b: 'x', c: { d: 'y' } } })).toEqual({ 'a.b': 'x', 'a.c.d': 'y' });
  });

  test('a key present in one locale only is reported', () => {
    const a = flatEntries({ x: { one: '1', two: '2' } });
    const b = flatEntries({ x: { one: '1' } });
    expect(Object.keys(b).sort()).not.toEqual(Object.keys(a).sort());
  });

  test('an interpolation variable present in one locale only is reported', () => {
    expect(interpolationVars('Hello {{name}}, {{count}} left')).toEqual(['count', 'name']);
    expect(interpolationVars('Halo {{name}}')).not.toEqual(
      interpolationVars('Hello {{name}}, {{count}} left'),
    );
  });
});
