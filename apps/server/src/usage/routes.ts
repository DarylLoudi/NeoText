import { BudgetQuerySchema, UsageSummaryQuerySchema } from '@neotext/shared';
import { Hono } from 'hono';
import type { z } from 'zod';
import { getAuth, requireAuth } from '../auth/middleware';
import type { Container } from '../container';
import type { AppEnv } from '../http/env';
import { AppError } from '../http/errors';
import { budgetStatus } from './budget';
import { summarizeUsage } from './summary';

function parseQuery<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(
      'validation_failed',
      'The usage range or time zone is invalid. Pick another range and try again.',
      400,
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }
  return parsed.data;
}

export function usageRoutes(container: Container): Hono<AppEnv> {
  const { db, settings, clock } = container;
  const routes = new Hono<AppEnv>();
  routes.use('/usage/*', requireAuth);
  routes.use('/usage/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  routes.get('/usage/summary', (c) => {
    const q = parseQuery(UsageSummaryQuerySchema, c.req.query());
    return c.json(summarizeUsage(db, getAuth(c).userId, q));
  });
  routes.get('/usage/budget', (c) => {
    const { timeZone } = parseQuery(BudgetQuerySchema, c.req.query());
    const auth = getAuth(c);
    const { budget } = settings.get(auth.userId, auth.dek).settings;
    return c.json(budgetStatus(db, auth.userId, budget, clock.now(), timeZone));
  });

  return routes;
}
