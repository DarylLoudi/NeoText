import type { Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { AppConfig } from '../config/env';

const COOKIE_MAX_AGE_S = 30 * 86_400;

export function sessionCookieName(cfg: AppConfig): string {
  return cfg.cookieSecure ? '__Host-neotext_session' : 'neotext_session';
}

export function setSessionCookie(
  c: Context,
  cfg: AppConfig,
  token: string,
  expiresAt: number,
  now: number,
): void {
  setCookie(c, sessionCookieName(cfg), token, {
    httpOnly: true,
    sameSite: 'Strict',
    path: '/',
    secure: cfg.cookieSecure,
    maxAge: Math.max(0, Math.min(COOKIE_MAX_AGE_S, Math.floor((expiresAt - now) / 1000))),
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(c: Context, cfg: AppConfig): void {
  deleteCookie(c, sessionCookieName(cfg), { path: '/', secure: cfg.cookieSecure });
}
