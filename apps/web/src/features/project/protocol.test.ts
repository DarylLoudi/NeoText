import { describe, expect, it } from 'vitest';
import { isFrameMessage } from './protocol';

describe('isFrameMessage', () => {
  it.each([
    { type: 'nt-preview-ready' },
    { type: 'nt-preview-ready', path: 'pages/a.html' },
    { type: 'nt-escape' },
    { type: 'nt-loaded' },
    { type: 'nt-console', level: 'error', text: 'boom' },
    { type: 'nt-blocked', url: 'https://cdn.example/x.js' },
    { type: 'nt-navigate', path: 'about.html' },
    { type: 'nt-storage', items: { a: '1' } },
  ])('accepts %j', (data) => {
    expect(isFrameMessage(data)).toBe(true);
  });

  it.each([
    null,
    'nt-loaded',
    { type: 'nt-eval', code: '1' },
    { type: 'nt-console', level: 'trace', text: 'x' },
    { type: 'nt-console', level: 'log', text: 'x'.repeat(2001) },
    { type: 'nt-storage', items: { a: 1 } },
    { type: 'nt-navigate', path: 'x'.repeat(501) },
    { type: 'nt-preview-ready', path: 1 },
  ])('refuses %j', (data) => {
    expect(isFrameMessage(data)).toBe(false);
  });

  it('refuses storage over the 1 MB the page may keep', () => {
    const big = (items: Record<string, string>) => isFrameMessage({ type: 'nt-storage', items });
    expect(big({ k: 'x'.repeat(1048575) })).toBe(true);
    expect(big({ k: 'x'.repeat(1048576) })).toBe(false);
    expect(big({ a: 'x'.repeat(600000), b: 'y'.repeat(600000) })).toBe(false);
  });
});
