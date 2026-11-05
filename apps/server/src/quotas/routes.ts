import { PutQuotaBodySchema } from '@neotext/shared';
import { Hono } from 'hono';
import { getAuth, requireAdmin, requireAuth } from '../auth/middleware';
import type { Container } from '../container';
import type { AppEnv } from '../http/env';
import { AppError } from '../http/errors';
import { readJson } from '../http/validate';

/** What a member has spent on shared models, and what an admin lets them spend. */
export function quotaRoutes(container: Container): Hono<AppEnv> {
  const { quotas, users, audit } = container;
  const routes = new Hono<AppEnv>();
  routes.use('/usage/quota', requireAuth);
  routes.use('/admin/quotas/*', requireAdmin);
  routes.use('/usage/quota', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });
  routes.use('/admin/quotas/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  routes.get('/usage/quota', (c) => c.json(quotas.status(getAuth(c).userId)));

  const known = (id: string) => {
    if (!users.findById(id)) throw new AppError('not_found', 'That user does not exist.', 404);
    return id;
  };
  const shape = (id: string) => ({ quota: quotas.own(id), effective: quotas.effective(id) });

  routes.get('/admin/quotas/:userId', (c) => c.json(shape(known(c.req.param('userId')))));

  routes.put('/admin/quotas/:userId', async (c) => {
    const id = known(c.req.param('userId'));
    const { quota } = await readJson(c, PutQuotaBodySchema);
    quotas.setForUser(id, quota);
    audit.record('admin.quota.updated', getAuth(c).userId, {
      targetId: id,
      dailyUsd: quota?.dailyUsd ?? null,
      monthlyUsd: quota?.monthlyUsd ?? null,
      reset: quota === null,
    });
    return c.json(shape(id));
  });

  return routes;
}
