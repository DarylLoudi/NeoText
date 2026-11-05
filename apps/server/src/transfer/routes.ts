import { ExportBodySchema, ImportSourceSchema } from '@neotext/shared';
import { type Context, Hono } from 'hono';
import { getAuth, requireAuth } from '../auth/middleware';
import type { Container } from '../container';
import type { AppEnv, AuthContext } from '../http/env';
import { AppError } from '../http/errors';
import { enforceLimit } from '../http/rate-limit';
import { readJson } from '../http/validate';

const encodeRfc5987 = (s: string) =>
  encodeURIComponent(s).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** `attachment` with an ASCII fallback name plus the exact UTF-8 name (RFC 6266 / 5987). */
export function attachmentHeader(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}

/** Imports running at once on this server, across all users. */
export const MAX_CONCURRENT_IMPORTS = 2;

export function transferRoutes(container: Container): Hono<AppEnv> {
  const { exporter, limiters } = container;
  const routes = new Hono<AppEnv>();
  /**
   * Each import can hold a 200 MiB upload and a large parsed file in memory, so a user runs
   * one at a time and the server at most `MAX_CONCURRENT_IMPORTS`; the rest are turned away.
   */
  const importing = new Set<string>();
  routes.use('/export', requireAuth);
  routes.use('/import', requireAuth);
  routes.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  routes.post('/export', async (c) => {
    const body = await readJson(c, ExportBodySchema);
    const auth = getAuth(c);
    // Whole-account exports read everything and sealing runs a slow key derivation;
    // exporting one chat as Markdown is cheap and stays under the general API limit only.
    const singleChat = body.format === 'markdown' && body.conversationId !== undefined;
    if (!singleChat) enforceLimit(c, limiters.export, auth.userId);
    const file = await exporter.exportData(auth, body);
    return c.body(new Uint8Array(file.data), 200, {
      'Content-Type': file.contentType,
      'Content-Disposition': attachmentHeader(file.filename),
      'X-Content-Type-Options': 'nosniff',
      // Attached files are not part of an export yet; the web says how many were left out.
      'X-Skipped-Attachments': String(file.skippedAttachments),
    });
  });
  // The 200 MiB body limit for this route lives with the others in `http/body-limits.ts`.
  routes.post('/import', async (c) => {
    const type = c.req.header('Content-Type') ?? '';
    if (!/^multipart\/form-data\s*;/i.test(type)) {
      throw new AppError('unsupported_media_type', 'Send the file as multipart/form-data.', 415);
    }
    const auth = getAuth(c);
    // Both checks come before the body is read: opening a bundle runs a slow key derivation,
    // every import writes a lot, and reading the upload alone can buffer 200 MiB. A request
    // turned away as busy does not use up the user's limit; only an import that starts does.
    if (importing.has(auth.userId)) {
      throw new AppError(
        'rate_limited',
        'Your last import is still running. Wait for it to finish, then try again.',
        429,
        { reason: 'import_running' },
      );
    }
    if (importing.size >= MAX_CONCURRENT_IMPORTS) {
      throw new AppError(
        'rate_limited',
        'Another import is running on this server. Try again when it has finished.',
        429,
        { reason: 'import_busy' },
      );
    }
    enforceLimit(c, limiters.import, auth.userId);
    // Taken in the same synchronous step as the checks above, so two requests cannot both pass.
    importing.add(auth.userId);
    try {
      return await runImport(c, auth);
    } finally {
      importing.delete(auth.userId);
    }
  });

  async function runImport(c: Context<AppEnv>, auth: AuthContext) {
    let form: Record<string, string | File>;
    try {
      form = await c.req.parseBody();
    } catch {
      throw new AppError('bad_request', 'The upload could not be read. Try again.', 400);
    }
    const source = ImportSourceSchema.safeParse(form.source);
    if (!source.success) {
      throw new AppError(
        'bad_request',
        'Pick where the file comes from: neotext, chatgpt or claude.',
        400,
      );
    }
    const file = form.file;
    if (!(file instanceof File) || file.size === 0) {
      throw new AppError('bad_request', 'Choose a file to import.', 400);
    }
    const passphrase = typeof form.passphrase === 'string' ? form.passphrase : undefined;
    const result = await container.importer.importData(auth, {
      source: source.data,
      file: Buffer.from(await file.arrayBuffer()),
      ...(passphrase ? { passphrase } : {}),
      restoreSettings: form.restoreSettings === 'true',
    });
    return c.json(result);
  }
  return routes;
}
