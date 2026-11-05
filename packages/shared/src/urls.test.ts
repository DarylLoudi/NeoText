import { describe, expect, test } from 'vitest';
import { domainOf, normalizeSourceUrl } from './urls';

describe('urls', () => {
  test.each([
    ['https://www.Example.com/a/?utm_source=x&b=2&a=1#top', 'https://example.com/a?a=1&b=2'],
    ['http://example.com/', 'https://example.com/'],
    ['https://example.com/path/', 'https://example.com/path'],
    ['https://x.com/p?fbclid=1&gclid=2&ref=hn', 'https://x.com/p'],
  ])('normalize %s', (input, out) => expect(normalizeSourceUrl(input)).toBe(out));
  test('rejects non-web urls', () => {
    expect(normalizeSourceUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeSourceUrl('nope')).toBeNull();
  });
  test('domainOf', () => {
    expect(domainOf('https://www.nodejs.org/en')).toBe('nodejs.org');
    expect(domainOf('nope')).toBe('');
  });
});
