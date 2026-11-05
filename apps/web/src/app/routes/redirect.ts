import { isAuthPath } from './root';

/** Only same-origin app paths are followed after sign-in; anything else becomes `/`. */
export function safeRedirect(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  const path = value.split(/[?#]/)[0] ?? '/';
  return isAuthPath(path) ? '/' : value;
}
