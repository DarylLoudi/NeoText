import { AuditQuerySchema } from '@neotext/shared';
import { Hono } from 'hono';
import { getAuth, requireAuth } from '../auth/middleware';
import type { Container } from '../container';
import type { AppEnv } from '../http/env';
import { AppError } from '../http/errors';

/** Your own events; an admin can also read everyone's (`?all=1`, optionally `&userId=`). */
export function auditRoutes(container: Container): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.use('/audit', requireAuth);

  routes.get('/audit', (c) => {
    const parsed = AuditQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      throw new AppError(
        'validation_failed',
        'The page size or filter is invalid. Fix it and try again.',
        400,
        parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      );
    }
    const q = parsed.data;
    const auth = getAuth(c);
    if (q.all && auth.role !== 'admin') {
      throw new AppError('forbidden', 'Only an admin can see activity from other accounts.', 403);
    }
    const page = container.audit.list({
      userId: q.all ? q.userId : auth.userId,
      cursor: q.cursor,
      limit: q.limit,
    });
    c.header('Cache-Control', 'no-store');
    return c.json(page);
  });

  return routes;
}
