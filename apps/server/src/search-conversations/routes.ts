import { SearchQuerySchema } from '@neotext/shared';
import { Hono } from 'hono';
import { getAuth, requireAuth } from '../auth/middleware';
import type { Container } from '../container';
import type { AppEnv } from '../http/env';
import { AppError } from '../http/errors';
import { enforceLimit } from '../http/rate-limit';

export function searchConversationsRoutes(container: Container): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.use('/search', requireAuth);
  routes.use('/search', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });
  routes.get('/search', (c) => {
    // Each search decrypts and scans the user's messages: well below the general API limit.
    enforceLimit(c, container.limiters.search, getAuth(c).userId);
    const parsed = SearchQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      throw new AppError(
        'validation_failed',
        'Type at least 2 characters to search.',
        400,
        parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      );
    }
    const { q, cursor, limit } = parsed.data;
    return c.json(container.search.search(getAuth(c), q, { cursor, limit }));
  });
  return routes;
}
