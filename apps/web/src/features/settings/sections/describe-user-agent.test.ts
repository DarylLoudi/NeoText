import { afterEach, expect, test } from 'vitest';
import { setLocale } from '../../../lib/i18n';
import { describeUserAgent } from './describe-user-agent';

const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const EDGE_WIN = `${CHROME_WIN} Edg/140.0.0.0`;
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';
const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SAFARI_IPAD =
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const CHROME_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1';

afterEach(() => setLocale('en'));

test.each([
  [CHROME_WIN, 'Chrome on Windows'],
  [EDGE_WIN, 'Edge on Windows'],
  [FIREFOX_LINUX, 'Firefox on Linux'],
  [SAFARI_MAC, 'Safari on macOS'],
  [SAFARI_IPHONE, 'Safari on iPhone'],
  [SAFARI_IPAD, 'Safari on iPad'],
  [CHROME_ANDROID, 'Chrome on Android'],
  [CHROME_IOS, 'Chrome on iPhone'],
  [null, 'Unknown device'],
  ['', 'Unknown device'],
  ['curl/8.4.0', 'Unknown device'],
])('describe %s', (ua, out) => {
  expect(describeUserAgent(ua)).toBe(out);
});

test('the connecting word and the fallback follow the language', () => {
  setLocale('id');
  expect(describeUserAgent(CHROME_WIN)).toBe('Chrome di Windows');
  expect(describeUserAgent(null)).toBe('Perangkat tidak dikenal');
});

test('a known browser on an unknown system is just the browser', () => {
  expect(describeUserAgent('Mozilla/5.0 (PlayStation 5) Firefox/130.0')).toBe('Firefox');
});
