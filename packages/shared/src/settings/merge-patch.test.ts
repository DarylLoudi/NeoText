import { expect, test } from 'vitest';
import { applyMergePatch } from './merge-patch';

test.each([
  [{ a: 'b' }, { a: 'c' }, { a: 'c' }],
  [{ a: 'b' }, { b: 'c' }, { a: 'b', b: 'c' }],
  [{ a: 'b' }, { a: null }, {}],
  [{ a: 'b', b: 'c' }, { a: null }, { b: 'c' }],
  [{ a: ['b'] }, { a: 'c' }, { a: 'c' }],
  [{ a: 'c' }, { a: ['b'] }, { a: ['b'] }],
  [{ a: { b: 'c' } }, { a: { b: 'd', c: null } }, { a: { b: 'd' } }],
  [{ a: [{ b: 'c' }] }, { a: [1] }, { a: [1] }],
  [
    ['a', 'b'],
    ['c', 'd'],
    ['c', 'd'],
  ],
  [{ a: 'b' }, ['c'], ['c']],
  [{ a: 'foo' }, null, null],
  [{ e: null }, { a: 1 }, { e: null, a: 1 }],
  [[1, 2], { a: 'b', c: null }, { a: 'b' }],
  [{}, { a: { bb: { ccc: null } } }, { a: { bb: {} } }],
])('merge %j with %j', (target, patch, expected) => {
  const before = structuredClone(target);
  const patchBefore = structuredClone(patch);
  expect(applyMergePatch(target, patch)).toEqual(expected);
  expect(target).toEqual(before);
  expect(patch).toEqual(patchBefore);
});

test('result does not share references with the patch', () => {
  const patch = { a: { b: [1] } };
  const out = applyMergePatch({}, patch) as typeof patch;
  out.a.b.push(2);
  expect(patch.a.b).toEqual([1]);
});

test('__proto__ keys cannot pollute', () => {
  const out = applyMergePatch({}, JSON.parse('{"__proto__":{"x":1}}'));
  expect(({} as Record<string, unknown>).x).toBeUndefined();
  expect((out as Record<string, unknown>).x).toBeUndefined();
});
