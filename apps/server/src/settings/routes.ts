import { PatchSettingsBodySchema, RestoreSettingsBodySchema } from '@neotext/shared';
import { Hono } from 'hono';
import { getAuth, requireAuth } from '../auth/middleware';
import type { Container } from '../container';
import type { AppEnv } from '../http/env';
import { readJson } from '../http/validate';

export function settingsRoutes(container: Container): Hono<AppEnv> {
  const { settings } = container;
  const routes = new Hono<AppEnv>();

  routes.use('/settings/*', requireAuth);
  routes.use('/settings/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  routes.get('/settings', (c) => {
    const { userId, dek } = getAuth(c);
    return c.json(settings.get(userId, dek));
  });

  routes.patch('/settings', async (c) => {
    const { userId, dek } = getAuth(c);
    const body = await readJson(c, PatchSettingsBodySchema);
    return c.json(settings.patch(userId, dek, body.patch));
  });

  routes.get('/settings/history', (c) => c.json({ items: settings.history(getAuth(c).userId) }));

  routes.post('/settings/restore', async (c) => {
    const { userId, dek } = getAuth(c);
    const body = await readJson(c, RestoreSettingsBodySchema);
    return c.json(settings.restore(userId, dek, body.version));
  });

  return routes;
}
