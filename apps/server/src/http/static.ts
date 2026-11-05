import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Context, Hono, Next } from 'hono';
import type { AppEnv } from './env';

const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Serves the built web app. Call after the API routes and before `notFound`.
 * Never answers `/api/*`: unknown API paths keep the JSON 404.
 */
export function serveWeb(app: Hono<AppEnv>, distDir: string): void {
  // serveStatic resolves paths against cwd, so hand it a cwd-relative root.
  const root = path.relative(process.cwd(), path.resolve(distDir)) || '.';
  const isApi = (p: string) => p === '/api' || p.startsWith('/api/');
  // The build writes .br and .gz next to each script and stylesheet (scripts/precompress.mjs).
  const files = serveStatic({ root, precompressed: true });
  const index = serveStatic({ root, path: 'index.html' });

  // Cache-Control is set after serveStatic has built the response.
  const withCache = (value: string) => async (c: Context<AppEnv>, next: Next) => {
    const reply = await files(c, next);
    if (reply && reply.status === 200) reply.headers.set('Cache-Control', value);
    return reply;
  };
  const assets = withCache(IMMUTABLE);

  // Refuse any path with a ".." segment (raw or percent-decoded) outright.
  app.use('*', async (c, next) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(c.req.path);
    } catch {
      return c.notFound();
    }
    if (decoded.split(/[/]/).includes('..')) return c.notFound();
    return next();
  });
  app.use('/assets/*', assets);
  app.use('*', async (c, next) => {
    const p = c.req.path;
    if (isApi(p) || p.startsWith('/assets/')) return next();
    // "/" and index.html are left to the fallback so they always carry no-cache.
    if (p === '/' || p.endsWith('/index.html')) return next();
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();
    // Unhashed files (theme-boot.js, favicon) must revalidate so upgrades are never stale.
    const reply = await files(c, next);
    if (reply && reply.status === 200) reply.headers.set('Cache-Control', 'no-cache');
    return reply;
  });
  app.get('*', async (c, next) => {
    const p = c.req.path;
    if (isApi(p) || p.startsWith('/assets/')) return next();
    const reply = await index(c, next);
    if (reply && reply.status === 200) reply.headers.set('Cache-Control', 'no-cache');
    return reply;
  });
}
