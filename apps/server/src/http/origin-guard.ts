import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './env';
import { AppError } from './errors';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function originGuard(allowed: string[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (UNSAFE.has(c.req.method)) {
      const site = c.req.header('Sec-Fetch-Site');
      const origin = c.req.header('Origin');
      const badSite = site !== undefined && site !== 'same-origin' && site !== 'none';
      const badOrigin = origin !== undefined && !allowed.includes(origin);
      if (badSite || badOrigin) {
        throw new AppError(
          'forbidden',
          'This request came from another site and was refused.',
          403,
        );
      }
    }
    await next();
  };
}
