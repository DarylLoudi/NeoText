import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppEnv } from './env';
import { AppError } from './errors';

const MiB = 1024 * 1024;

/** Routes allowed a body above the default; each needs a session to send one. */
export const BODY_LIMITS = [
  { prefix: '/api/chat', maxBytes: 4 * MiB },
  { prefix: '/api/attachments', maxBytes: 25 * MiB },
  { prefix: '/api/import', maxBytes: 200 * MiB },
];
const DEFAULT_MAX_BYTES = 1 * MiB;

const limiters = new Map<number, MiddlewareHandler>();
function limiterFor(maxBytes: number): MiddlewareHandler {
  let l = limiters.get(maxBytes);
  if (!l) {
    l = bodyLimit({
      maxSize: maxBytes,
      onError: () => {
        throw new AppError('payload_too_large', 'That request is too large.', 413);
      },
    });
    limiters.set(maxBytes, l);
  }
  return l;
}

/**
 * Body size limits. Runs after the session and API rate limit middleware. hono's `bodyLimit`
 * trusts a declared Content-Length (Node never delivers more than it says) but reads a chunked
 * body into memory, up to the limit, before anything after it runs. So the routes with a large
 * limit take a body only from a signed-in user, and only with a Content-Length: a chunked one
 * is a 411 before a byte of it is read, which also keeps their own guards (rate limits, the
 * import slots, the storage cap) ahead of the read. Everything else keeps the 1 MiB default.
 */
export function bodyLimits(): MiddlewareHandler<AppEnv> {
  return (c, next) => {
    const path = c.req.path;
    const match = BODY_LIMITS.find((l) => path === l.prefix || path.startsWith(`${l.prefix}/`));
    if (match && c.req.raw.body) {
      if (!c.get('auth')) throw new AppError('unauthorized', 'Sign in to continue.', 401);
      if (c.req.raw.headers.has('transfer-encoding')) {
        throw new AppError(
          'bad_request',
          'Send this request with a Content-Length header, not in chunks.',
          411,
          { reason: 'length_required' },
        );
      }
    }
    return limiterFor(match?.maxBytes ?? DEFAULT_MAX_BYTES)(c, next);
  };
}
