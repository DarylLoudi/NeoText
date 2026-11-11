import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { ensureMarkdown } from '../features/chat/markdown/engine';
import { initI18n, registerLocale, registerPageStrings } from '../lib/i18n';
import enPages from '../lib/i18n/locales/en.pages.json';
import id from '../lib/i18n/locales/id.json';
import idPages from '../lib/i18n/locales/id.pages.json';
import { server } from './msw';

// Pages and the sidebar arrive as lazy chunks; under a full parallel run their first import can
// take longer than testing-library's one-second default wait.
configure({ asyncUtilTimeout: 5000 });

void initI18n('en');
// Tests switch locale synchronously, so the Indonesian chunk is registered up front.
registerLocale('id', id);
// The Settings and Admin strings load with those routes in the app; tests have them from the start.
registerPageStrings('en', enPages);
registerPageStrings('id', idPages);

// happy-dom mimics the browser by logging every failed fetch ("GET /x 401 (Unauthorized)") and
// network error straight to stderr. API tests assert those failures on purpose, so drop only that.
const stderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
  const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
  const isFetchNoise =
    /^[A-Z]+ \S+ \d{3} \(.*\)\s*$/.test(text) ||
    (text.startsWith('TypeError: Network error') && text.includes('@mswjs/interceptors')) ||
    // A request the client aborted before any answer (the header timeout test).
    (text.startsWith('Error: socket hang up') && text.includes('@mswjs/interceptors'));
  if (isFetchNoise) return true;
  return (stderrWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
}) as typeof process.stderr.write;

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
// Messages render markdown synchronously in tests. Loaded here, after each file's vi.mock calls
// are registered, so a mocked renderer is the one the lazy chunk picks up.
beforeAll(async () => {
  await ensureMarkdown();
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
