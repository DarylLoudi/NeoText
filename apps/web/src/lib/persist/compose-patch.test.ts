import { applyMergePatch } from '@neotext/shared';
import { describe, expect, test } from 'vitest';
import { canComposePatches, composePatches } from './compose-patch';

describe('composePatches', () => {
  test('keeps deletions and nests', () => {
    expect(composePatches({ a: { b: 1 }, c: null }, { a: { d: 2 } })).toEqual({
      a: { b: 1, d: 2 },
      c: null,
    });
    expect(composePatches({ a: { b: 1 } }, { a: null })).toEqual({ a: null });
  });
  test('arrays and primitives from the later patch win', () => {
    expect(composePatches({ a: [1, 2], b: 1, c: { x: 1 } }, { a: [3], b: 2, c: 5 })).toEqual({
      a: [3],
      b: 2,
      c: 5,
    });
  });
  test('a nested deletion in the later patch is kept', () => {
    expect(composePatches({ a: { b: 1 } }, { a: { b: null } })).toEqual({ a: { b: null } });
  });
  test('does not mutate or alias its inputs', () => {
    const a = { x: { y: [1] } };
    const b = { x: { z: { q: 1 } } };
    const out = composePatches(a, b);
    (out.x as { z: { q: number } }).z.q = 9;
    expect(a).toEqual({ x: { y: [1] } });
    expect(b).toEqual({ x: { z: { q: 1 } } });
  });
  test('composing equals applying one after the other when composable', () => {
    const target = { a: { b: 1, keep: true }, c: 3, d: [1] };
    const p1 = { a: { b: 2 }, c: null };
    const p2 = { a: { e: 1 }, d: [2], c: 4 };
    expect(canComposePatches(p1, p2)).toBe(true);
    expect(applyMergePatch(target, composePatches(p1, p2))).toEqual(
      applyMergePatch(applyMergePatch(target, p1), p2),
    );
  });
});

describe('canComposePatches', () => {
  test('an object written over a deletion or a scalar cannot be one patch', () => {
    expect(canComposePatches({ a: null }, { a: { b: 1 } })).toBe(false);
    expect(canComposePatches({ a: 'x' }, { a: { b: 1 } })).toBe(false);
    expect(canComposePatches({ a: { b: null } }, { a: { b: { c: 1 } } })).toBe(false);
  });
  test('everything else composes', () => {
    expect(canComposePatches({ a: { b: 1 } }, { a: { c: 1 } })).toBe(true);
    expect(canComposePatches({ a: null }, { a: 1 })).toBe(true);
    expect(canComposePatches({}, { a: { b: 1 } })).toBe(true);
  });
});
