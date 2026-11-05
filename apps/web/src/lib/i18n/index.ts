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

let wanted: Locale = 'en';

/** Switches to `lng`, fetching its strings first if needed; settles once it is active. */
async function switchTo(lng: Locale): Promise<void> {
  wanted = lng;
  if (lng !== 'en' && !i18next.hasResourceBundle(lng, 'translation')) {
    try {
      registerLocale(lng, await loaders[lng]());
    } catch {
      return; // The chunk failed to load: stay in the current language.
    }
    if (wanted !== lng) return; // Another choice came in while this one loaded.
  }
  await i18next.changeLanguage(lng);
}

export function initI18n(setting: LocaleSetting): Promise<void> {
  const lng = resolveLocale(setting, browserLanguage());
  if (!i18next.isInitialized) {
    void i18next.use(initReactI18next).init({
      resources: { en: { translation: en } },
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
