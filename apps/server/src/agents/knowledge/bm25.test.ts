import { expect, test } from 'vitest';
import { rankChunks, tokenize } from './bm25';

const chunks = [
  { id: 'c1', text: 'Photosynthesis turns light into chemical energy in the chloroplast.' },
  { id: 'c2', text: 'Turunan fungsi aljabar dihitung dengan aturan pangkat dan aturan rantai.' },
  { id: 'c3', text: 'The French revolution began in 1789 and changed European politics.' },
  { id: 'c4', text: 'Integral tentu menghitung luas daerah di bawah kurva fungsi.' },
  { id: 'c5', text: 'Mitochondria release energy from glucose; the chloroplast captures light.' },
];

test('the relevant chunk ranks first for an English query', () => {
  const ranked = rankChunks('how does photosynthesis capture light energy', chunks);
  expect(ranked[0]?.id).toBe('c1');
  expect(ranked.map((r) => r.id)).toContain('c5');
  expect(ranked.map((r) => r.id)).not.toContain('c3');
});

test('the relevant chunk ranks first for an Indonesian query', () => {
  expect(rankChunks('bagaimana cara menghitung turunan fungsi?', chunks)[0]?.id).toBe('c2');
  expect(rankChunks('luas di bawah kurva', chunks)[0]?.id).toBe('c4');
});

test('stopwords, short tokens and case or diacritics do not change the match', () => {
  expect(tokenize('The À la carte café is in a village')).toEqual([
    'la',
    'carte',
    'cafe',
    'village',
  ]);
  expect(tokenize('yang dan di ke dari untuk')).toEqual([]);
  // A query of stopwords only matches nothing, though every chunk holds some of them.
  expect(rankChunks('the and of yang dengan', chunks)).toEqual([]);
  expect(rankChunks('PHOTOSYNTHÉSIS', chunks)[0]?.id).toBe('c1');
});

test('at most k results, best first, and chunks without a query word are left out', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({
    id: `m${i}`,
    text: `energy ${'energy '.repeat(i)}filler`,
  }));
  const ranked = rankChunks('energy', [...many, { id: 'none', text: 'nothing here' }]);
  expect(ranked).toHaveLength(6);
  expect(ranked.map((r) => r.id)).not.toContain('none');
  const scores = ranked.map((r) => r.score);
  expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  expect(rankChunks('energy', many, 2)).toHaveLength(2);
});
