import { expect, test } from 'vitest';
import { pageSizeForWidth, paginate } from './pagination';

test('ranges', () => {
  expect(paginate(9, 4, 0)).toEqual({
    page: 0,
    pageCount: 3,
    start: 0,
    end: 4,
    hasPrev: false,
    hasNext: true,
  });
  expect(paginate(9, 4, 2)).toEqual({
    page: 2,
    pageCount: 3,
    start: 8,
    end: 9,
    hasPrev: true,
    hasNext: false,
  });
  expect(paginate(9, 4, 99).page).toBe(2);
  expect(paginate(0, 4, 0)).toMatchObject({ pageCount: 1, hasNext: false });
});

test('a negative page is the first one', () => {
  expect(paginate(9, 4, -3)).toMatchObject({ page: 0, start: 0, end: 4, hasPrev: false });
});

test.each([
  [900, 4],
  [720, 4],
  [600, 3],
  [400, 2],
  [320, 1],
])('width %i → %i per page', (w, n) => expect(pageSizeForWidth(w)).toBe(n));
