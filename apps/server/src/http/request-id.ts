import crypto from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './env';

export function requestId(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const id = crypto.randomUUID();
    c.set('requestId', id);
    c.header('X-Request-Id', id);
    await next();
  };
}
