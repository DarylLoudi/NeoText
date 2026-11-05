import { CreateFolderBodySchema, UpdateFolderBodySchema } from '@neotext/shared';
import { Hono } from 'hono';
import { getAuth, requireAuth } from '../auth/middleware';
import type { Container } from '../container';
import type { AppEnv } from '../http/env';
import { readJson } from '../http/validate';

export function folderRoutes(container: Container): Hono<AppEnv> {
  const { conversations } = container;
  const routes = new Hono<AppEnv>();
  routes.use('/folders', requireAuth);
  routes.use('/folders/*', requireAuth);
  routes.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  routes.get('/folders', (c) => c.json({ folders: conversations.listFolders(getAuth(c)) }));
  routes.post('/folders', async (c) => {
    const body = await readJson(c, CreateFolderBodySchema);
    return c.json(conversations.createFolder(getAuth(c), body), 201);
  });
  routes.patch('/folders/:id', async (c) => {
    const body = await readJson(c, UpdateFolderBodySchema);
    return c.json(conversations.updateFolder(getAuth(c), c.req.param('id'), body));
  });
  routes.delete('/folders/:id', (c) => {
    conversations.removeFolder(getAuth(c), c.req.param('id'));
    return c.body(null, 204);
  });
  return routes;
}
