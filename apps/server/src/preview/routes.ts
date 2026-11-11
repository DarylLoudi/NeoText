import { type Context, Hono } from 'hono';
import type { AppEnv } from '../http/env';
import { PREVIEW_CSP, PREVIEW_PERMISSIONS, PREVIEW_SHELL } from './shell';

/**
 * `GET /preview-frame/<page>`: the shell a chat project's preview runs in, the same at every
 * path. The frame opens it at the page's own path, so a page that moves itself
 * (`location.href = 'about.html'`) lands on the shell again and the app can load that page.
 * Static and public; the project itself never comes here, the browser hands it to the frame.
 */
export function previewRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const shell = (c: Context<AppEnv>) => {
    c.header('Content-Security-Policy', PREVIEW_CSP);
    c.header('Permissions-Policy', PREVIEW_PERMISSIONS);
    c.header('Cache-Control', 'public, max-age=3600');
    c.header('X-Content-Type-Options', 'nosniff');
    return c.html(PREVIEW_SHELL);
  };
  routes.get('/preview-frame', shell);
  routes.get('/preview-frame/*', shell);
  return routes;
}
