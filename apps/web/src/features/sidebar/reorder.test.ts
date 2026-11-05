import { expect, test } from 'vitest';
import { stepPosition } from './reorder';

const keys = ['a0', 'a1', 'a2', 'a3'];

/** The ids in key order after giving `index` its new key. */
function after(index: number, key: string): number[] {
  const next = keys.map((k, i) => (i === index ? key : k));
  return next
    .map((k, i) => [k, i] as const)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, i]) => i);
}

test('moving up lands between the two rows above', () => {
  const key = stepPosition(keys, 2, -1);
  expect(key).not.toBeNull();
  expect(after(2, key as string)).toEqual([0, 2, 1, 3]);
});

test('moving up into first place lands before the first row', () => {
  expect(after(1, stepPosition(keys, 1, -1) as string)).toEqual([1, 0, 2, 3]);
});

test('moving down lands between the two rows below, or after the last', () => {
  expect(after(1, stepPosition(keys, 1, 1) as string)).toEqual([0, 2, 1, 3]);
  expect(after(2, stepPosition(keys, 2, 1) as string)).toEqual([0, 1, 3, 2]);
});

test('the ends cannot move further', () => {
  expect(stepPosition(keys, 0, -1)).toBeNull();
  expect(stepPosition(keys, 3, 1)).toBeNull();
  expect(stepPosition(keys, -1, 1)).toBeNull();
});
