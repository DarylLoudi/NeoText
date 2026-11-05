import type { Context } from 'hono';
import type { z } from 'zod';
import { AppError } from './errors';

export async function readJson<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  const type = c.req.header('Content-Type') ?? '';
  if (!/^application\/json\s*(;|$)/i.test(type)) {
    throw new AppError('unsupported_media_type', 'Send the body as application/json.', 415);
  }
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new AppError('bad_request', 'The request body is not valid JSON.', 400);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(
      'validation_failed',
      'Some fields are missing or invalid. Fix them and try again.',
      400,
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }
  return parsed.data;
}
