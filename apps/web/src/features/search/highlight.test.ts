import { expect, test } from 'vitest';
import { splitHighlight } from './highlight';

test('maps folded matches back to the original text', () => {
  expect(splitHighlight('Kafe café', 'cafe')).toEqual([
    { text: 'Kafe ', match: false },
    { text: 'café', match: true },
  ]);
});

test('marks every occurrence, ignoring case', () => {
  expect(splitHighlight('Ab ab AB', 'ab')).toEqual([
    { text: 'Ab', match: true },
    { text: ' ', match: false },
    { text: 'ab', match: true },
    { text: ' ', match: false },
    { text: 'AB', match: true },
  ]);
});

test('special characters are literal', () => {
  expect(splitHighlight('use c++ or c', 'c++')).toEqual([
    { text: 'use ', match: false },
    { text: 'c++', match: true },
    { text: ' or c', match: false },
  ]);
  expect(splitHighlight('<b>x</b>', '<b>')).toEqual([
    { text: '<b>', match: true },
    { text: 'x</b>', match: false },
  ]);
});

test('decomposed accents stay inside the mark', () => {
  expect(splitHighlight('café!', 'cafe')).toEqual([
    { text: 'café', match: true },
    { text: '!', match: false },
  ]);
});

test('no match and empty inputs', () => {
  expect(splitHighlight('hello', 'zz')).toEqual([{ text: 'hello', match: false }]);
  expect(splitHighlight('hello', '')).toEqual([{ text: 'hello', match: false }]);
  expect(splitHighlight('', 'a')).toEqual([]);
});
