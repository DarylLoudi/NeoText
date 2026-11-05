import { CreateProviderBodySchema, UpdateProviderBodySchema } from '@neotext/shared';
import { Hono } from 'hono';
import { getAuth, requireAuth } from '../auth/middleware';
import type { Container } from '../container';
import type { AppEnv } from '../http/env';
import { readJson } from '../http/validate';
import { PROVIDER_PRESETS } from './presets';

export function providerRoutes(container: Container): Hono<AppEnv> {
  const { providers } = container;
  const routes = new Hono<AppEnv>();
  for (const path of ['/provider-presets', '/providers', '/providers/*', '/models']) {
    routes.use(path, requireAuth);
  }
  routes.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  routes.get('/provider-presets', (c) => c.json({ presets: PROVIDER_PRESETS }));
  routes.get('/providers', (c) => c.json({ providers: providers.list(getAuth(c)) }));
  routes.post('/providers', async (c) => {
    const body = await readJson(c, CreateProviderBodySchema);
    return c.json({ provider: await providers.create(getAuth(c), body) }, 201);
  });
  routes.patch('/providers/:id', async (c) => {
    const body = await readJson(c, UpdateProviderBodySchema);
    return c.json({ provider: await providers.update(getAuth(c), c.req.param('id'), body) });
  });
  routes.delete('/providers/:id', (c) => {
    providers.remove(getAuth(c), c.req.param('id'));
    return c.body(null, 204);
  });
  routes.post('/providers/:id/test', async (c) =>
    c.json(await providers.test(getAuth(c), c.req.param('id'))),
  );
  routes.post('/providers/:id/warm', (c) => {
    providers.warm(getAuth(c), c.req.param('id'));
    return c.body(null, 204);
  });
  routes.get('/providers/:id/models', async (c) => {
    const refresh = c.req.query('refresh') === '1';
    return c.json(await providers.models(getAuth(c), c.req.param('id'), { refresh }));
  });
  routes.get('/models', async (c) => c.json(await providers.allModels(getAuth(c))));
  return routes;
}
