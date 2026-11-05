import type dns from 'node:dns';
import { CreateMcpServerBodySchema, UpdateMcpServerBodySchema } from '@neotext/shared';
import { Hono } from 'hono';
import { getAuth, requireAuth } from '../auth/middleware';
import type { Container } from '../container';
import type { AppEnv, AuthContext } from '../http/env';
import { AppError } from '../http/errors';
import { readJson } from '../http/validate';
import { checkEndpointUrl } from '../providers/endpoint-url';
import { endpointPolicy } from '../providers/policy';
import { safeName } from './naming';
import { createMcpRepo, type McpRepo } from './repo';

export const MCP_MAX_SERVERS = 10;
const notFound = () => new AppError('not_found', 'That MCP server does not exist.', 404);

/** The same rules as provider endpoints: metadata never, private networks by `endpointPolicy`. */
function checkUrl(
  auth: AuthContext,
  url: string,
  lookup: typeof dns.lookup | undefined,
): Promise<void> {
  const policy = endpointPolicy(auth.role);
  return checkEndpointUrl(url, policy, lookup);
}

/**
 * Removes the tool policies of a server that went away, was renamed or moved, or of an earlier
 * server whose name a new one takes, so "always allow" never passes to a different server
 * (ruling R26). With the server's last known tool list, only those exact names go; without one,
 * names under its `mcp_<name>_` prefix go, except those under the prefix of another server the
 * user still has (`github` must not take `github_enterprise` with it). The merge patch deletes
 * only those keys, so every other setting stays. A failure is logged without names or values
 * and never fails the request: the server change itself has already been made.
 */
function forgetPolicies(
  container: Container,
  repo: McpRepo,
  auth: AuthContext,
  server: { id: string; name: string; known: string[] | null },
): void {
  try {
    const prefix = `mcp_${safeName(server.name)}_`;
    const others = repo
      .list(auth.userId)
      .filter((s) => s.id !== server.id)
      .map((s) => `mcp_${safeName(s.name)}_`)
      .filter((p) => p !== prefix);
    const known = server.known === null ? null : new Set(server.known);
    const { policies } = container.settings.get(auth.userId, auth.dek).settings.tools;
    const gone = Object.keys(policies).filter(
      (name) =>
        (known ? known.has(name) : name.startsWith(prefix)) &&
        !others.some((p) => name.startsWith(p)),
    );
    if (gone.length === 0) return;
    const patch = Object.fromEntries(gone.map((name) => [name, null]));
    container.settings.patch(auth.userId, auth.dek, { tools: { policies: patch } });
  } catch (err) {
    container.log.error(
      { err: err instanceof Error ? err.name : 'unknown' },
      'forgetting MCP tool policies failed',
    );
  }
}

/** Tool names start with the sanitized server name, so two servers may not share it. */
function checkNameFree(repo: McpRepo, userId: string, name: string, selfId: string | null) {
  const wanted = safeName(name);
  const clash = repo.list(userId).some((s) => s.id !== selfId && safeName(s.name) === wanted);
  if (clash) throw new AppError('bad_request', 'Another tool server already uses that name.', 400);
}

/** Synchronous, so a check right before the insert is atomic with it (better-sqlite3). */
function checkCanCreate(repo: McpRepo, userId: string, name: string) {
  if (repo.list(userId).length >= MCP_MAX_SERVERS) {
    throw new AppError('bad_request', `You can add up to ${MCP_MAX_SERVERS} tool servers.`, 400);
  }
  checkNameFree(repo, userId, name, null);
}

export function mcpRoutes(
  container: Container,
  opts: { lookup?: typeof dns.lookup } = {},
): Hono<AppEnv> {
  const { mcp } = container;
  const repo = createMcpRepo(container.db, container.clock);
  const routes = new Hono<AppEnv>();
  for (const path of ['/mcp-servers', '/mcp-servers/*']) {
    routes.use(path, requireAuth);
    routes.use(path, async (c, next) => {
      await next();
      c.header('Cache-Control', 'no-store');
    });
  }

  routes.get('/mcp-servers', (c) => c.json({ servers: repo.list(getAuth(c).userId) }));

  routes.post('/mcp-servers', async (c) => {
    const auth = getAuth(c);
    const body = await readJson(c, CreateMcpServerBodySchema);
    checkCanCreate(repo, auth.userId, body.name);
    await checkUrl(auth, body.url, opts.lookup);
    // Checked again after the lookup: concurrent creates may have filled the gap meanwhile.
    checkCanCreate(repo, auth.userId, body.name);
    const server = repo.create(auth.userId, auth.dek, body);
    // Policies left by an earlier server of this name are not this server's.
    forgetPolicies(container, repo, auth, { id: server.id, name: server.name, known: null });
    return c.json({ server }, 201);
  });

  routes.patch('/mcp-servers/:id', async (c) => {
    const auth = getAuth(c);
    const id = c.req.param('id');
    const body = await readJson(c, UpdateMcpServerBodySchema);
    const before = repo.get(auth.userId, id);
    if (!before) throw notFound();
    if (body.name !== undefined) checkNameFree(repo, auth.userId, body.name, id);
    if (body.url !== undefined) await checkUrl(auth, body.url, opts.lookup);
    // Again after the lookup, right before the write, for concurrent renames.
    if (body.name !== undefined) checkNameFree(repo, auth.userId, body.name, id);
    const known = mcp.toolNames(id);
    const server = repo.update(auth.userId, auth.dek, id, body);
    if (!server) throw notFound();
    mcp.invalidate(id);
    // The tool names change only with the sanitized name; another URL may be another server.
    if (safeName(server.name) !== safeName(before.name) || server.url !== before.url) {
      forgetPolicies(container, repo, auth, { id, name: before.name, known });
    }
    return c.json({ server });
  });

  routes.delete('/mcp-servers/:id', (c) => {
    const auth = getAuth(c);
    const id = c.req.param('id');
    const server = repo.get(auth.userId, id);
    const known = mcp.toolNames(id);
    if (!server || !repo.remove(auth.userId, id)) throw notFound();
    mcp.invalidate(id);
    forgetPolicies(container, repo, auth, { id, name: server.name, known });
    return c.body(null, 204);
  });

  routes.post('/mcp-servers/:id/test', async (c) =>
    c.json(await mcp.test(getAuth(c), c.req.param('id'))),
  );

  return routes;
}
