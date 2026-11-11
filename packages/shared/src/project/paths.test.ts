import { describe, expect, it } from 'vitest';
import { normalizeProjectPath } from './paths';

describe('normalizeProjectPath', () => {
  it('drops a leading ./ and keeps folders', () => {
    expect(normalizeProjectPath('./css/style.css')).toBe('css/style.css');
    expect(normalizeProjectPath('index.html')).toBe('index.html');
  });

  it('turns backslashes into slashes', () => {
    expect(normalizeProjectPath('a\\b.css')).toBe('a/b.css');
  });

  it('trims spaces around the path', () => {
    expect(normalizeProjectPath('  app.js ')).toBe('app.js');
  });

  it.each([
    '../x.html',
    'a/../x.html',
    '/etc/passwd',
    'C:/x.html',
    'a/b/c/d/e.html',
    'x.exe',
    'noextension',
    '',
    'my page.html',
    'a//b.css',
  ])('refuses %j', (raw) => {
    expect(normalizeProjectPath(raw)).toBeNull();
  });

  it('accepts every allowed extension, in any case', () => {
    for (const ext of ['html', 'htm', 'css', 'js', 'mjs', 'json', 'svg', 'txt', 'md', 'HTML']) {
      expect(normalizeProjectPath(`f.${ext}`)).toBe(`f.${ext}`);
    }
  });
});
