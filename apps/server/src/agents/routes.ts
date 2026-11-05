import { AgentCreateSchema, AgentUpdateSchema } from '@neotext/shared';
import { Hono } from 'hono';
import { getAuth, requireAuth } from '../auth/middleware';
import type { Container } from '../container';
import type { AppEnv } from '../http/env';
import { readJson } from '../http/validate';

export function agentRoutes(container: Container): Hono<AppEnv> {
  const { agents } = container;
  const routes = new Hono<AppEnv>();
  routes.use('/agents', requireAuth);
  routes.use('/agents/*', requireAuth);
  routes.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  routes.get('/agents', (c) => c.json({ agents: agents.list(getAuth(c)) }));
  routes.post('/agents', async (c) => {
    const body = await readJson(c, AgentCreateSchema);
    return c.json(agents.create(getAuth(c), body), 201);
  });
  routes.patch('/agents/:id', async (c) => {
    const body = await readJson(c, AgentUpdateSchema);
    agents.update(getAuth(c), c.req.param('id'), body);
    return c.body(null, 204);
  });
  routes.delete('/agents/:id', (c) => {
    agents.remove(getAuth(c), c.req.param('id'));
    return c.body(null, 204);
  });
  return routes;
}
