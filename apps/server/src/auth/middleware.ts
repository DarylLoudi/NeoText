import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Container } from '../container';
import type { AppEnv, AuthContext } from '../http/env';
import { AppError } from '../http/errors';
import { enforceLimit } from '../http/rate-limit';
import { clearSessionCookie, sessionCookieName, setSessionCookie } from './cookies';

/** Resolves the session cookie to `auth`, or null; a cookie that no longer works is cleared. */
export function sessionMiddleware(container: Container): MiddlewareHandler<AppEnv> {
  const { config, sessions, users } = container;
  const name = sessionCookieName(config);
  return async (c, next) => {
    c.set('auth', null);
    let slidTo: number | null = null;
    const token = getCookie(c, name);
    if (token) {
      const session = sessions.resolve(token);
      const user = session ? users.findById(session.userId) : null;
      if (session && user && user.status === 'active') {
        c.set('auth', {
          userId: user.id,
          username: user.username,
          role: user.role,
          sessionId: session.sessionId,
          dek: session.dek,
        });
        if (session.slid) slidTo = session.expiresAt;
      } else {
        clearSessionCookie(c, config);
      }
    }
    await next();
    // Keep the browser cookie as long-lived as the session; routes that set or clear it win.
    if (slidTo !== null && token && !c.res.headers.has('set-cookie')) {
      setSessionCookie(c, config, token, slidTo, container.clock.now());
    }
  };
}

/** Per-user API limit; runs right after `sessionMiddleware`. */
export function apiRateLimit(container: Container): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get('auth');
    if (auth) enforceLimit(c, container.limiters.api, auth.userId);
    await next();
  };
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('auth')) throw new AppError('unauthorized', 'Sign in to continue.', 401);
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = c.get('auth');
  if (!auth) throw new AppError('unauthorized', 'Sign in to continue.', 401);
  if (auth.role !== 'admin') {
    throw new AppError('forbidden', 'Only an admin can do that.', 403);
  }
  await next();
};

export function getAuth(c: Context<AppEnv>): AuthContext {
  const auth = c.get('auth');
  if (!auth) throw new AppError('unauthorized', 'Sign in to continue.', 401);
  return auth;
}
