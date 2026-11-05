import { ListQuerySchema, UpdateConversationBodySchema } from '@neotext/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { getAuth, requireAuth } from '../auth/middleware';
import type { Container } from '../container';
import type { AppEnv } from '../http/env';
import { AppError } from '../http/errors';
import { readJson } from '../http/validate';

const CreateConversationBodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  folderId: z.string().nullable().optional(),
});

const ForkBodySchema = z.object({ messageId: z.string().min(1) });

export function conversationRoutes(container: Container): Hono<AppEnv> {
  const { conversations } = container;
  const routes = new Hono<AppEnv>();
  routes.use('/conversations', requireAuth);
  routes.use('/conversations/*', requireAuth);
  routes.use('/trash', requireAuth);
  routes.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  routes.get('/conversations', (c) => {
    const parsed = ListQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      throw new AppError(
        'validation_failed',
        'Some filters are missing or invalid. Fix them and try again.',
        400,
        parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      );
    }
    return c.json(conversations.list(getAuth(c), parsed.data));
  });
  routes.post('/conversations', async (c) => {
    const body = await readJson(c, CreateConversationBodySchema);
    return c.json(conversations.create(getAuth(c), body), 201);
  });
  routes.get('/conversations/:id', (c) =>
    c.json(conversations.detail(getAuth(c), c.req.param('id'))),
  );
  routes.patch('/conversations/:id', async (c) => {
    const body = await readJson(c, UpdateConversationBodySchema);
    return c.json(conversations.update(getAuth(c), c.req.param('id'), body));
  });
  routes.delete('/conversations/:id', (c) => {
    if (c.req.query('permanent') === '1') {
      conversations.deleteForever(getAuth(c), c.req.param('id'));
    } else {
      conversations.remove(getAuth(c), c.req.param('id'));
    }
    return c.body(null, 204);
  });
  routes.delete('/trash', (c) => c.json(conversations.emptyTrash(getAuth(c))));
  routes.post('/conversations/:id/restore', (c) =>
    c.json(conversations.restore(getAuth(c), c.req.param('id'))),
  );
  routes.post('/conversations/:id/fork', async (c) => {
    const body = await readJson(c, ForkBodySchema);
    return c.json(await conversations.fork(getAuth(c), c.req.param('id'), body.messageId), 201);
  });
  return routes;
}
