import type { ToolsResponse } from '@neotext/shared';
import { Hono } from 'hono';
import { getAuth, requireAuth } from '../auth/middleware';
import type { Container } from '../container';
import type { AppEnv } from '../http/env';
import { resolveSearchBackend } from '../search/resolve';
import { assembleToolSet } from './registry';

export function toolRoutes(container: Container): Hono<AppEnv> {
  const { tools, settings, providers } = container;
  const routes = new Hono<AppEnv>();
  routes.use('/tools', requireAuth);

  /** `?only=meta` leaves the tool list empty, so asking for `webSearchBackend` connects nothing. */
  routes.get('/tools', async (c) => {
    const auth = getAuth(c);
    const userSettings = settings.get(auth.userId, auth.dek).settings;
    const { policies } = userSettings.tools;
    const list = c.req.query('only') === 'meta' ? [] : await tools.list(auth);
    const set = assembleToolSet(list, policies);
    const body: ToolsResponse = {
      tools: list.map((t) => ({
        name: t.name,
        description: t.description,
        source: t.source,
        policy: set.policy(t.name),
        defaultPolicy: t.defaultPolicy,
        ...(t.mcp ? { mcp: t.mcp } : {}),
      })),
      webSearchBackend:
        resolveSearchBackend(auth, providers, userSettings.webSearch.backendProviderId) !== null,
    };
    c.header('Cache-Control', 'no-store');
    return c.json(body);
  });

  return routes;
}
