import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defaultSettings } from '@neotext/shared';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { applyAppearance, resolveTheme } from './theme';

const STORAGE_KEY = 'neotext:appearance';

function runThemeBoot(): HTMLElement {
  const source = readFileSync(
    path.resolve(import.meta.dirname, '../../public/theme-boot.js'),
    'utf8',
  );
  new Function(source)();
  return document.documentElement;
}

function snapshotAttributes(root: HTMLElement) {
  const attrs = [
    'data-theme',
    'data-accent',
    'data-ui-font',
    'data-reading-font',
    'data-code-font',
    'data-width',
    'data-density',
    'data-motion',
  ];
  return {
    attrs: Object.fromEntries(attrs.map((a) => [a, root.getAttribute(a)])),
    scale: root.style.getPropertyValue('--font-scale'),
  };
}

function reset(root: HTMLElement) {
  for (const a of [...root.attributes]) root.removeAttribute(a.name);
  root.removeAttribute('style');
}

beforeEach(() => {
  localStorage.clear();
  reset(document.documentElement);
  vi.restoreAllMocks();
});

describe('applyAppearance', () => {
  test('applies attributes and scale', () => {
    const root = document.createElement('html');
    applyAppearance(
      {
        ...defaultSettings().appearance,
        theme: 'dark',
        accent: 'mint',
        fontScale: 1.125,
        messageWidth: 'wide',
      },
      root,
    );
    expect(root.dataset).toMatchObject({ theme: 'dark', accent: 'mint', width: 'wide' });
    expect(root.style.getPropertyValue('--font-scale')).toBe('1.125');
  });

  test('reduce motion turns motion off, keep turns it on', () => {
    const root = document.createElement('html');
    const base = defaultSettings().appearance;
    applyAppearance({ ...base, reduceMotion: 'on' }, root);
    expect(root.dataset.motion).toBe('off');
    applyAppearance({ ...base, reduceMotion: 'off' }, root);
    expect(root.dataset.motion).toBe('on');
  });

  test('system theme and system motion remove their attributes', () => {
    const root = document.createElement('html');
    const base = defaultSettings().appearance;
    applyAppearance({ ...base, theme: 'dark', reduceMotion: 'on' }, root);
    expect(root.dataset.theme).toBe('dark');
    expect(root.dataset.motion).toBe('off');
    applyAppearance({ ...base, theme: 'system', reduceMotion: 'system' }, root);
    expect(root.dataset.theme).toBeUndefined();
    expect(root.dataset.motion).toBeUndefined();
  });

  test('stores a snapshot for theme-boot', () => {
    const appearance = { ...defaultSettings().appearance, theme: 'light' as const };
    applyAppearance(appearance, document.createElement('html'));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual(appearance);
  });

  test('storage failure does not throw', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() =>
      applyAppearance(defaultSettings().appearance, document.createElement('html')),
    ).not.toThrow();
  });

  test('lazy-loads Literata only when selected', async () => {
    const base = defaultSettings().appearance;
    const root = document.createElement('html');
    const loaded = vi.fn();
    applyAppearance({ ...base, readingFont: 'atkinson' }, root, loaded);
    applyAppearance({ ...base, readingFont: 'literata' }, root, loaded);
    await vi.waitFor(() => expect(loaded).toHaveBeenCalledTimes(1));
  });
});

describe('resolveTheme', () => {
  test('follows the system only for system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('theme-boot.js agrees with applyAppearance', () => {
  const cases = [
    { theme: 'dark', accent: 'rose', reduceMotion: 'on', fontScale: 1.25, messageWidth: 'narrow' },
    { theme: 'system', reduceMotion: 'system', readingFont: 'literata', density: 'compact' },
    { theme: 'light', uiFont: 'system', codeFont: 'system-mono', reduceMotion: 'off' },
    {},
  ] as const;

  test('theme-boot.js turns motion off for reduce', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...defaultSettings().appearance, reduceMotion: 'on' }),
    );
    expect(runThemeBoot().dataset.motion).toBe('off');
  });

  test.each(cases)('same attributes for %o', (override) => {
    const appearance = { ...defaultSettings().appearance, ...override };
    const viaReact = document.createElement('html');
    applyAppearance(appearance, viaReact);
    const stored = localStorage.getItem(STORAGE_KEY);
    expect(stored).not.toBeNull();
    const viaBoot = runThemeBoot();
    expect(snapshotAttributes(viaBoot)).toEqual(snapshotAttributes(viaReact));
  });
});
