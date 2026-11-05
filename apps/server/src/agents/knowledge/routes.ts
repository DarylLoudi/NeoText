import { Hono } from 'hono';
import { getAuth, requireAuth } from '../../auth/middleware';
import type { Container } from '../../container';
import type { AppEnv } from '../../http/env';
import { AppError } from '../../http/errors';
import { enforceLimit } from '../../http/rate-limit';

const noFile = () =>
  new AppError('bad_request', 'Send the file as multipart form data in a "file" field.', 400);

/** An agent's knowledge files. The body limit of the upload is set in `BODY_LIMITS`. */
export function knowledgeRoutes(container: Container): Hono<AppEnv> {
  const { knowledge } = container;
  const routes = new Hono<AppEnv>();
  routes.use('/agents/:id/files', requireAuth);
  routes.use('/agents/:id/files/*', requireAuth);
  routes.use('/agents/:id/files', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });
  routes.use('/agents/:id/files/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  routes.get('/agents/:id/files', (c) =>
    c.json({ files: knowledge.list(getAuth(c), c.req.param('id')) }),
  );
  routes.post('/agents/:id/files', async (c) => {
    const type = c.req.header('content-type') ?? '';
    if (!type.toLowerCase().startsWith('multipart/form-data')) throw noFile();
    const auth = getAuth(c);
    const agentId = c.req.param('id');
    // Before the body is read: a missing agent or a full one never costs a parse.
    enforceLimit(c, container.limiters.upload, auth.userId);
    knowledge.checkUpload(auth, agentId);
    let file: unknown;
    try {
      file = (await c.req.parseBody()).file;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw noFile();
    }
    if (!(file instanceof File)) throw noFile();
    const created = await knowledge.add(auth, agentId, {
      name: file.name,
      mime: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return c.json(created, 201);
  });
  routes.delete('/agents/:agentId/files/:fileId', (c) => {
    knowledge.remove(getAuth(c), c.req.param('agentId'), c.req.param('fileId'));
    return c.body(null, 204);
  });
  return routes;
}
