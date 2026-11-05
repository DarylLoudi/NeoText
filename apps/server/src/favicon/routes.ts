import { Hono } from 'hono';
import { getAuth, requireAuth } from '../auth/middleware';
import type { Container } from '../container';
import type { AppEnv } from '../http/env';
import { AppError } from '../http/errors';
import { isValidHost } from './service';

export function faviconRoutes(container: Container): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.use('/favicon', requireAuth);

  routes.get('/favicon', async (c) => {
    const host = c.req.query('host') ?? '';
    if (!isValidHost(host)) {
      throw new AppError('bad_request', 'Give a site name such as example.com as "host".', 400);
    }
    const icon = await container.favicon.get(host, getAuth(c).userId);
    if (!icon) throw new AppError('not_found', 'This site has no icon we can show.', 404);
    // Remote bytes on our origin: sniffed raster only, plus headers that stop any active content.
    c.header('Content-Type', icon.mime);
    c.header('Cache-Control', 'private, max-age=604800');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Content-Security-Policy', "default-src 'none'; sandbox");
    return c.body(new Uint8Array(icon.data));
  });

  return routes;
}
