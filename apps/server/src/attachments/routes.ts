import { attachmentKind } from '@neotext/shared';
import { Hono } from 'hono';
import { getAuth, requireAuth } from '../auth/middleware';
import type { Container } from '../container';
import type { AppEnv } from '../http/env';
import { AppError } from '../http/errors';
import { enforceLimit } from '../http/rate-limit';

const noFile = () =>
  new AppError('bad_request', 'Send the file as multipart form data in a "file" field.', 400);

/** RFC 6266 filename: an ASCII fallback plus the exact name, percent-encoded. */
function dispositionFor(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function attachmentRoutes(container: Container): Hono<AppEnv> {
  const { attachments } = container;
  const routes = new Hono<AppEnv>();
  routes.use('/attachments', requireAuth);
  routes.use('/attachments/*', requireAuth);

  // The 25 MiB body limit for this path is applied app-wide by `bodyLimits()` before parsing.
  routes.post('/attachments', async (c) => {
    const type = c.req.header('content-type') ?? '';
    if (!type.toLowerCase().startsWith('multipart/form-data')) throw noFile();
    // Before the body is read: an upload is up to 25 MiB to buffer, hash, seal and write.
    const auth = getAuth(c);
    enforceLimit(c, container.limiters.upload, auth.userId);
    // A user already at the storage cap is turned away before anything is read.
    attachments.checkQuota(auth, 1);
    let file: unknown;
    try {
      file = (await c.req.parseBody()).file;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw noFile();
    }
    if (!(file instanceof File)) throw noFile();
    const created = await attachments.upload(auth, {
      name: file.name,
      mime: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    c.header('Cache-Control', 'no-store');
    return c.json(created, 201);
  });

  routes.get('/attachments/:id', async (c) => {
    const auth = getAuth(c);
    const id = c.req.param('id');
    // Decrypted bytes stay out of the disk cache for long: the browser revalidates every time,
    // and an unchanged file costs a 304 without being opened.
    const etag = attachments.etag(auth, id);
    c.header('ETag', etag);
    c.header('Cache-Control', 'private, no-cache');
    const ifNoneMatch = c.req.header('if-none-match');
    if (ifNoneMatch?.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) {
      return c.body(null, 304);
    }
    const { attachment, bytes } = await attachments.read(auth, id);
    const kind = attachmentKind(attachment.mime);
    // Our own origin serves user bytes: only sniffed rasters render, nothing else can run.
    c.header('Content-Type', kind === 'text' ? 'text/plain; charset=utf-8' : attachment.mime);
    c.header(
      'Content-Disposition',
      dispositionFor(kind === 'image' ? 'inline' : 'attachment', attachment.name),
    );
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Content-Security-Policy', "sandbox; default-src 'none'");
    return c.body(new Uint8Array(bytes));
  });

  return routes;
}
