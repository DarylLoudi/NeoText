import { translate } from '../../../lib/i18n';

// Order matters: Edge and Chrome on iOS also say "Chrome" or "Safari", and Chrome says "Safari".
const BROWSERS: [name: string, test: RegExp][] = [
  ['Edge', /\b(?:Edg|EdgA|EdgiOS|Edge)\//],
  ['Firefox', /\b(?:Firefox|FxiOS)\//],
  ['Chrome', /\b(?:Chrome|CriOS)\//],
  ['Safari', /\bSafari\//],
];

// iPhone and iPad first: their user agents also say "Mac OS X". Android also says "Linux".
const SYSTEMS: [name: string, test: RegExp][] = [
  ['iPhone', /\biPhone\b/],
  ['iPad', /\biPad\b/],
  ['Android', /\bAndroid\b/],
  ['Windows', /\bWindows\b/],
  ['macOS', /\bMacintosh\b/],
  ['Linux', /\bLinux\b/],
];

const first = (table: [string, RegExp][], ua: string) =>
  table.find(([, test]) => test.test(ua))?.[0];

/** "Chrome on Windows" from a user agent; browser and system names are proper nouns. */
export function describeUserAgent(userAgent: string | null): string {
  const ua = userAgent ?? '';
  const browser = first(BROWSERS, ua);
  const system = first(SYSTEMS, ua);
  if (browser && system) {
    return translate('settings.security.sessions.device', { browser, system });
  }
  return browser ?? system ?? translate('settings.security.sessions.unknownDevice');
}
