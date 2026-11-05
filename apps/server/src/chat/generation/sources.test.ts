import { expect, test } from 'vitest';
import { createSourceCollector, SNIPPET_MAX, toSnippet } from './sources';

test('dedupes by normalized url and numbers in arrival order', () => {
  const s = createSourceCollector();
  expect(s.add({ url: 'https://bitcoinprice.corgano.com/', title: 'A', content: 'x' })?.n).toBe(1);
  expect(
    s.add({ url: 'http://bitcoinprice.corgano.com', title: 'A again', content: 'y' }),
  ).toBeNull();
  expect(
    s.add({
      url: 'https://www.bitgetapp.com/price/bitcoin?utm_source=feed',
      title: '',
      content: 'z',
    }),
  ).toMatchObject({ n: 2, title: 'bitgetapp.com', domain: 'bitgetapp.com' });
  expect(s.all().map((x) => x.n)).toEqual([1, 2]);
});

test('invalid urls are rejected and long titles are cut', () => {
  const s = createSourceCollector();
  expect(s.add({ url: 'not a url', title: 'T', content: '' })).toBeNull();
  expect(s.add({ url: 'ftp://example.com/x', title: 'T', content: '' })).toBeNull();
  const added = s.add({ url: 'https://example.com/a', title: 'T'.repeat(500), content: '' });
  expect(added?.title.length).toBe(300);
  expect(s.all()).toHaveLength(1);
});

test('snippets are plain and short', () => {
  expect(toSnippet('**Bold** and [a link](https://x.org)\n\n# Heading')).toBe(
    'Bold and a link Heading',
  );
  const long = toSnippet('word '.repeat(200));
  expect(long.length).toBeLessThanOrEqual(400);
  expect(long.endsWith('…')).toBe(true);
  expect(SNIPPET_MAX).toBe(400);
});

test('snippets drop code fences and keep short text unchanged', () => {
  expect(toSnippet('before\n```js\nconst a = 1;\n```\nafter')).toBe('before const a = 1; after');
  expect(toSnippet('  plain   text  ')).toBe('plain text');
});
