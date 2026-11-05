import type { Source } from '@neotext/shared';
import { expect, test } from 'vitest';
import { citationLinks } from './citations';

function source(n: number, url: string): Source {
  return { n, url, title: `Source ${n}`, domain: new URL(url).hostname, snippet: '' };
}

test('matches through tracking params and www', () => {
  const link = citationLinks([source(3, 'https://www.bitgetapp.com/price/bitcoin')]);
  expect(link('https://bitgetapp.com/price/bitcoin?utm_source=x')?.attrs['data-source']).toBe('3');
  expect(link('https://bitgetapp.com/price/bitcoin')?.className).toBe('md-cite');
  expect(link('https://other.org/')).toBeNull();
});

test('links that are not web addresses are left alone', () => {
  const link = citationLinks([source(1, 'https://example.com/')]);
  expect(link('mailto:someone@example.com')).toBeNull();
});
