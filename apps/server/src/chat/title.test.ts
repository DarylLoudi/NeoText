import { expect, test } from 'vitest';
import { fallbackTitle, sanitizeTitle } from './title';

test.each([
  ['"Rencana Bab 2 Skripsi."', 'Rencana Bab 2 Skripsi'],
  ['# **Caching** basics', 'Caching basics'],
  ['   ', null],
])('sanitize %j', (input, expected) => {
  expect(sanitizeTitle(input)).toBe(expected);
});

test('sanitize cuts long titles at a word', () => {
  const out = sanitizeTitle('kata '.repeat(40)) as string;
  expect(out.length).toBeLessThanOrEqual(80);
  expect(out.endsWith('kata')).toBe(true);
});

test('fallback cuts at a word', () => {
  expect(
    fallbackTitle('Bagaimana cara menyusun bab dua skripsi tentang caching terdistribusi'),
  ).toBe('Bagaimana cara menyusun bab dua skripsi tentang…');
});

test('fallback keeps short text whole', () => {
  expect(fallbackTitle('  Halo   dunia ')).toBe('Halo dunia');
});
