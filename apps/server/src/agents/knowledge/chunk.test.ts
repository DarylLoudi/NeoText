import { expect, test } from 'vitest';
import { CHUNK_OVERLAP, CHUNK_SIZE, chunkPages } from './chunk';

test('long text without spaces is cut at the size with the overlap carried over', () => {
  const text = Array.from({ length: 3000 }, (_, i) => String.fromCharCode(97 + (i % 26))).join('');
  const chunks = chunkPages([{ n: null, text }]);
  expect(chunks.map((c) => c.text.length)).toEqual([1200, 1200, 1000]);
  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1]?.text ?? '';
    expect(chunks[i]?.text.slice(0, CHUNK_OVERLAP)).toBe(prev.slice(-CHUNK_OVERLAP));
  }
  expect(chunks.at(-1)?.text.endsWith(text.slice(-50))).toBe(true);
});

test('words are not split, chunks stay within the size, and every word is kept', () => {
  const words = Array.from({ length: 900 }, (_, i) => `word${i}`);
  const chunks = chunkPages([{ n: 1, text: words.join(' ') }]);
  expect(chunks.length).toBeGreaterThan(3);
  for (const c of chunks) {
    expect(c.text.length).toBeLessThanOrEqual(CHUNK_SIZE);
    expect(c.text).toMatch(/^word\d+ .* word\d+$/);
  }
  const seen = new Set(chunks.flatMap((c) => c.text.split(' ')));
  expect(words.every((w) => seen.has(w))).toBe(true);
});

test('pages are carried through and chunks never cross them', () => {
  const chunks = chunkPages([
    { n: 1, text: 'first   page\n\n\n\ntext' },
    { n: 2, text: 'x'.repeat(1500) },
    { n: 3, text: '   ' },
  ]);
  expect(chunks.map((c) => c.page)).toEqual([1, 2, 2]);
  expect(chunks[0]?.text).toBe('first page\n\ntext');
});

test('size and overlap can be set', () => {
  const chunks = chunkPages([{ n: null, text: 'abcdefghij' }], 4, 1);
  expect(chunks.map((c) => c.text)).toEqual(['abcd', 'defg', 'ghij']);
});
