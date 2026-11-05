import type { UserSettings } from '@neotext/shared';

export type AppearanceSnapshot = UserSettings['appearance'];

const STORAGE_KEY = 'neotext:appearance';

export function resolveTheme(
  theme: AppearanceSnapshot['theme'],
  prefersDark: boolean,
): 'light' | 'dark' {
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  return theme;
}

/**
 * `data-motion` says whether motion runs, base.css reads it that way: the "Reduce" choice
 * (`reduceMotion: 'on'`) turns motion off, "Keep" turns it on, "System" leaves it to the OS.
 */
const MOTION: Record<AppearanceSnapshot['reduceMotion'], 'on' | 'off' | undefined> = {
  system: undefined,
  on: 'off',
  off: 'on',
};

function setAttr(root: HTMLElement, name: string, value: string | undefined) {
  if (value === undefined) root.removeAttribute(name);
  else root.setAttribute(name, value);
}

/**
 * Mirrors public/theme-boot.js (which runs before React mounts); a test keeps the two in step.
 * `onReadingFontLoaded` fires after the lazy Literata stylesheet has loaded.
 */
export function applyAppearance(
  a: AppearanceSnapshot,
  root: HTMLElement = document.documentElement,
  onReadingFontLoaded?: () => void,
): void {
  setAttr(root, 'data-theme', a.theme === 'system' ? undefined : a.theme);
  setAttr(root, 'data-accent', a.accent);
  setAttr(root, 'data-ui-font', a.uiFont);
  setAttr(root, 'data-reading-font', a.readingFont);
  setAttr(root, 'data-code-font', a.codeFont);
  setAttr(root, 'data-width', a.messageWidth);
  setAttr(root, 'data-density', a.density);
  setAttr(root, 'data-motion', MOTION[a.reduceMotion]);
  root.style.setProperty('--font-scale', String(a.fontScale));

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
  } catch {
    // Storage unavailable: the next load just flashes the defaults.
  }

  if (a.readingFont === 'literata') {
    void import('@fontsource-variable/literata/wght.css').then(
      () => onReadingFontLoaded?.(),
      () => {
        // Font failed to load: the Georgia fallback in the token keeps text readable.
      },
    );
  }
}
