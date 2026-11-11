import i18next, { type TOptions } from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import en from './locales/en.json';

export type Locale = 'en' | 'id';
export type LocaleSetting = Locale | 'auto';

/** `auto` follows the browser: Indonesian when the language starts with `id`, else English. */
export function resolveLocale(setting: LocaleSetting, browserLanguage: string): Locale {
  if (setting !== 'auto') return setting;
  return browserLanguage.toLowerCase().startsWith('id') ? 'id' : 'en';
}

function browserLanguage(): string {
  return typeof navigator === 'undefined' ? 'en' : (navigator.language ?? 'en');
}

type Resources = typeof en;

/**
 * English ships in the entry chunk (it is also the fallback); every other locale is its own
 * chunk, fetched the first time it is chosen.
 */
const loaders: Record<Exclude<Locale, 'en'>, () => Promise<Resources>> = {
  id: () => import('./locales/id.json').then((m) => m.default),
};

/** Remembers the last choice so the next visit boots straight into it. */
const LOCALE_KEY = 'neotext:locale';

/** Makes a locale's strings available without fetching them (tests register `id` up front). */
export function registerLocale(locale: Locale, resources: Resources): void {
  i18next.addResourceBundle(locale, 'translation', resources, true, true);
}

/**
 * The Settings and Admin pages' own strings, kept out of the first page. They merge into the
 * locale's bundle the first time one of those pages opens (and on any later language switch).
 */
const pageLoaders: Record<Locale, () => Promise<object>> = {
  en: () => import('./locales/en.pages.json').then((m) => m.default),
  id: () => import('./locales/id.pages.json').then((m) => m.default),
};
const pagesLoaded = new Set<Locale>();
let pagesWanted = false;

async function loadPageStrings(lng: Locale): Promise<void> {
  if (pagesLoaded.has(lng)) return;
  const strings = await pageLoaders[lng]();
  i18next.addResourceBundle(lng, 'translation', strings, true, false);
  pagesLoaded.add(lng);
}

/** Registers page strings already in hand (tests load every string up front). */
export function registerPageStrings(lng: Locale, strings: object): void {
  i18next.addResourceBundle(lng, 'translation', strings, true, false);
  pagesLoaded.add(lng);
}

/**
 * Loads the Settings and Admin strings for the current language and English (the fallback).
 * Those routes await it beside their own chunk; a failed load leaves English keys showing.
 */
export async function ensurePageStrings(): Promise<void> {
  pagesWanted = true;
  try {
    await Promise.all([loadPageStrings('en'), loadPageStrings(getLocale())]);
  } catch {
    // The chunk failed to load: the page still opens, and a reload tries again.
  }
}

let wanted: Locale = 'en';

/** Switches to `lng`, fetching its strings first if needed; settles once it is active. */
async function switchTo(lng: Locale): Promise<void> {
  wanted = lng;
  try {
    if (lng !== 'en' && !i18next.hasResourceBundle(lng, 'translation')) {
      registerLocale(lng, await loaders[lng]());
    }
    if (pagesWanted) await loadPageStrings(lng);
  } catch {
    return; // The chunk failed to load: stay in the current language.
  }
  if (wanted !== lng) return; // Another choice came in while this one loaded.
  await i18next.changeLanguage(lng);
}

export function initI18n(setting: LocaleSetting): Promise<void> {
  const lng = resolveLocale(setting, browserLanguage());
  if (!i18next.isInitialized) {
    void i18next.use(initReactI18next).init({
      // A copy: i18next merges page strings into the bundle in place, and the import stays as written.
      resources: { en: { translation: structuredClone(en) } },
      lng: 'en',
      fallbackLng: 'en',
      supportedLngs: ['en', 'id'],
      interpolation: { escapeValue: false },
      initAsync: false,
      react: { useSuspense: false },
    });
  }
  return switchTo(lng);
}

/** The locale setting saved by the last `setLocale`, or `auto`. */
export function savedLocale(): LocaleSetting {
  try {
    const saved = localStorage.getItem(LOCALE_KEY);
    return saved === 'en' || saved === 'id' ? saved : 'auto';
  } catch {
    return 'auto';
  }
}

export function setLocale(setting: LocaleSetting): void {
  try {
    localStorage.setItem(LOCALE_KEY, setting);
  } catch {
    // Storage unavailable: the next visit follows the browser until settings load.
  }
  void initI18n(setting);
}

export function getLocale(): Locale {
  return i18next.language === 'id' ? 'id' : 'en';
}

/** Translate outside React (formatting helpers, toasts raised from stores). */
export function translate(key: string, options?: TOptions): string {
  return i18next.t(key, options) as string;
}

export function useT() {
  return useTranslation().t;
}
