import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './env';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

/**
 * `hsts` is on when cookies are `Secure` (an https public URL): browsers then refuse plain
 * http for this host for a year, so a network attacker cannot strip TLS on a later visit.
 */
export function securityHeaders(opts: { hsts: boolean }): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    // A route may set a stricter policy of its own (the favicon proxy does).
    if (!c.res.headers.has('Content-Security-Policy')) c.header('Content-Security-Policy', CSP);
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Cross-Origin-Opener-Policy', 'same-origin');
    c.header('Cross-Origin-Resource-Policy', 'same-origin');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (opts.hsts) c.header('Strict-Transport-Security', 'max-age=31536000');
  };
}
