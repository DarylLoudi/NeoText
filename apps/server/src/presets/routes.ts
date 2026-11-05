import { CreatePresetBodySchema, UpdatePresetBodySchema } from '@neotext/shared';
import { Hono } from 'hono';
import { getAuth, requireAuth } from '../auth/middleware';
import type { Container } from '../container';
import type { AppEnv } from '../http/env';
import { readJson } from '../http/validate';

export function presetRoutes(container: Container): Hono<AppEnv> {
  const { presets } = container;
  const routes = new Hono<AppEnv>();
  routes.use('/presets', requireAuth);
  routes.use('/presets/*', requireAuth);
  routes.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  routes.get('/presets', (c) => c.json({ presets: presets.list(getAuth(c)) }));
  routes.post('/presets', async (c) => {
    const body = await readJson(c, CreatePresetBodySchema);
    return c.json(presets.create(getAuth(c), body), 201);
  });
  routes.patch('/presets/:id', async (c) => {
    const body = await readJson(c, UpdatePresetBodySchema);
    return c.json(presets.update(getAuth(c), c.req.param('id'), body));
  });
  routes.delete('/presets/:id', (c) => {
    presets.remove(getAuth(c), c.req.param('id'));
    return c.body(null, 204);
  });
  return routes;
}
