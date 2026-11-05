import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import pino from 'pino';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { loadConfig } from '../config/env';
import type { Container } from '../container';
import { createFakeClock } from '../lib/clock';
import type { AppEnv } from './env';
import { AppError, errorHandler, notFoundHandler } from './errors';
import { readJson } from './validate';

type Body = {
  error: { code: string; requestId: string; message: string; details?: unknown };
};

function build(env: 'production' | 'test') {
  const config = loadConfig({ NODE_ENV: env });
  const c: Container = {
    config,
    log: pino({ level: 'silent' }),
    clock: createFakeClock(),
    db: {} as Container['db'],
    instanceKey: Buffer.alloc(32),
    instance: {} as Container['instance'],
    audit: {} as Container['audit'],
    users: {} as Container['users'],
    invites: {} as Container['invites'],
    sessions: {} as Container['sessions'],
    auth: {} as Container['auth'],
    admin: {} as Container['admin'],
    settings: {} as Container['settings'],
    providers: {} as Container['providers'],
    quotas: {} as Container['quotas'],
    repos: {} as Container['repos'],
    conversations: {} as Container['conversations'],
    search: {} as Container['search'],
    presets: {} as Container['presets'],
    agents: {} as Container['agents'],
    exporter: {} as Container['exporter'],
    attachments: {} as Container['attachments'],
    importer: {} as Container['importer'],
    limiters: {} as Container['limiters'],
    generations: {} as Container['generations'],
    chat: {} as Container['chat'],
    tools: {} as Container['tools'],
    favicon: {} as Container['favicon'],
    mcp: {} as Container['mcp'],
    http: {} as Container['http'],
    close: async () => {},
  };
  const app = new Hono<AppEnv>();
  app.use(async (ctx, next) => {
    ctx.set('requestId', 'req-1');
    await next();
  });
  app.get('/app-error', () => {
    throw new AppError('conflict', 'Already there.', 409);
  });
  app.get('/boom', () => {
    throw new Error('kaboom');
  });
  app.get('/http/:status', (ctx) => {
    throw new HTTPException(Number(ctx.req.param('status')) as 400, { message: 'Nope.' });
  });
  app.post('/json', async (ctx) => ctx.json(await readJson(ctx, z.object({ a: z.string() }))));
  app.notFound(notFoundHandler);
  app.onError(errorHandler(c));
  return app;
}

describe('error handling', () => {
  test('AppError keeps its code and status', async () => {
    const res = await build('test').request('/app-error');
    expect(res.status).toBe(409);
    const body = (await res.json()) as Body;
    expect(body.error.code).toBe('conflict');
    expect(body.error.requestId).toBe('req-1');
  });
  test('unknown error is a 500 without stack in production', async () => {
    const res = await build('production').request('/boom');
    expect(res.status).toBe(500);
    const body = (await res.json()) as Body;
    expect(body.error.code).toBe('internal');
    expect(body.error).not.toHaveProperty('details');
    expect(body.error.message).toContain('req-1');
  });
  test('unknown error includes the stack outside production', async () => {
    const body = (await (await build('test').request('/boom')).json()) as Body;
    expect((body.error.details as { stack: string }).stack).toContain('kaboom');
  });
  test('readJson rejects non-JSON and invalid bodies', async () => {
    const app = build('test');
    const text = await app.request('/json', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'hi',
    });
    expect(text.status).toBe(415);
    expect(((await text.json()) as Body).error.code).toBe('unsupported_media_type');
    const headers = { 'Content-Type': 'application/json' };
    const broken = await app.request('/json', { method: 'POST', headers, body: '{' });
    expect(broken.status).toBe(400);
    expect(((await broken.json()) as Body).error.code).toBe('bad_request');
    const invalid = await app.request('/json', { method: 'POST', headers, body: '{}' });
    expect(invalid.status).toBe(400);
    const body = (await invalid.json()) as Body;
    expect(body.error.code).toBe('validation_failed');
    expect((body.error.details as { path: unknown[] }[])[0]?.path).toEqual(['a']);
  });
  test('HTTPException keeps its status in the usual error shape', async () => {
    const app = build('production');
    const cases = [
      [413, 'payload_too_large'],
      [400, 'bad_request'],
      [401, 'internal'],
    ] as const;
    for (const [status, code] of cases) {
      const res = await app.request(`/http/${status}`);
      expect(res.status).toBe(status);
      const body = (await res.json()) as Body;
      expect(body.error).toMatchObject({ code, message: 'Nope.', requestId: 'req-1' });
    }
  });
});
