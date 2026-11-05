import { UpdateAdminInstanceBodySchema, UpdateAdminUserBodySchema } from '@neotext/shared';
import { Hono } from 'hono';
import { getAuth, requireAdmin } from '../auth/middleware';
import type { Container } from '../container';
import type { AppEnv } from '../http/env';
import { enforceLimit } from '../http/rate-limit';
import { readJson } from '../http/validate';

/** Users and instance policy. Invites live with the other sign-up routes in `auth/routes`. */
export function adminRoutes(container: Container): Hono<AppEnv> {
  const { admin, limiters } = container;
  const routes = new Hono<AppEnv>();
  routes.use('/admin/*', requireAdmin);
  routes.use('/admin/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  routes.get('/admin/users', (c) => c.json({ users: admin.users() }));

  routes.patch('/admin/users/:id', async (c) => {
    const body = await readJson(c, UpdateAdminUserBodySchema);
    return c.json({ user: admin.updateUser(getAuth(c), c.req.param('id'), body) });
  });

  routes.post('/admin/users/:id/reset-password', async (c) => {
    // Each reset runs Argon2, so it shares the limit of the other password routes.
    enforceLimit(c, limiters.sensitive, `reset:${getAuth(c).userId}`);
    return c.json(await admin.resetPassword(getAuth(c), c.req.param('id')));
  });

  routes.get('/admin/instance', (c) => c.json(admin.instance()));

  routes.patch('/admin/instance', async (c) => {
    const body = await readJson(c, UpdateAdminInstanceBodySchema);
    return c.json(admin.updateInstance(getAuth(c), body));
  });

  return routes;
}
