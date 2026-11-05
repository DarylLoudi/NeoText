import type { McpTestResult } from '@neotext/shared';
import type { AuthContext } from '../http/env';
import { AppError } from '../http/errors';
import type { Clock } from '../lib/clock';
import type { Logger } from '../lib/logger';
import type { HttpClient } from '../net/http-client';
import { BlockedUrlError } from '../net/ssrf';
import { endpointPolicy } from '../providers/policy';
import type { ToolDefinition, ToolResult } from '../tools/types';
import { connectMcp, MCP_REQUEST_TIMEOUT_MS, type McpConnection, type McpToolInfo } from './client';
import { mcpToolLabel, mcpToolName } from './naming';
import type { McpRepo, McpServerConfig } from './repo';

export const MCP_TOOLS_TTL_MS = 300_000;
export const MCP_IDLE_CLOSE_MS = 300_000;
export const MCP_LIST_WAIT_MS = 2_000;
/** A server that failed or missed the cold deadline is not waited on again for this long. */
export const MCP_RETRY_AFTER_MS = 60_000;
/** MCP tools offered in one turn, across all servers. */
export const MCP_TURN_MAX_TOOLS = 64;
/** Longest tool name the settings test shows. */
const TEST_NAME_MAX = 64;

const CHANGED = 'This MCP server was changed or removed. Send the message again.';

export interface McpManager {
  /** Tools of the user's enabled servers; slow or failing servers are skipped, never thrown. */
  toolsFor(auth: AuthContext): Promise<ToolDefinition[]>;
  test(auth: AuthContext, id: string): Promise<McpTestResult>;
  /** The model-facing names of the server's last listed tools, or null when none is known. */
  toolNames(serverId: string): string[] | null;
  /** Drops the server's connection and cached tools, after it was changed or removed. */
  invalidate(serverId: string): void;
  closeAll(): Promise<void>;
}

export interface McpManagerDeps {
  repo: McpRepo;
  http: { endpoints: HttpClient; endpointsPrivate: HttpClient };
  clock: Clock;
  log: Logger;
  /** Test seams. */
  connect?: typeof connectMcp;
  testTimeoutMs?: number;
}

interface Entry {
  config: McpServerConfig;
  /** What the cached state was built for; a different one starts over. */
  fingerprint: string;
  http: HttpClient;
  conn: Promise<McpConnection> | null;
  connecting: AbortController | null;
  tools: McpToolInfo[] | null;
  fetchedAt: number;
  refreshing: Promise<void> | null;
  /** Clock time before which a cold turn skips this server instead of trying it. */
  retryAt: number;
  /** Colliding names dropped last time, so the warning is logged only when it changes. */
  collided: number;
  idle: NodeJS.Timeout | null;
}

/** Code-point order, independent of locale. */
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const errName = (err: unknown) => (err instanceof Error ? err.name : 'unknown');

function isBlocked(err: unknown): BlockedUrlError | null {
  for (let e = err, depth = 0; e && depth < 8; depth++) {
    if (e instanceof BlockedUrlError) return e;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

/** A plain sentence for the settings page; never the server's own error text. */
function testMessage(err: unknown): string {
  const blocked = isBlocked(err);
  if (blocked?.reason === 'private') {
    return 'This address is on a private network. Only the admin can add endpoints like that.';
  }
  if (blocked) return 'This address is not allowed. Use a public http or https address.';
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'number' && code >= 400 && code <= 599) {
    return `The MCP server answered with HTTP ${code}. Check the address and headers.`;
  }
  return "Couldn't connect to the MCP server. Check the address and that the server is running.";
}

/** Resolves after `ms` without keeping the process alive; `cancel` frees the timer. */
function delay(ms: number): { done: Promise<void>; cancel(): void } {
  let timer: NodeJS.Timeout | undefined;
  const done = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
  return { done, cancel: () => clearTimeout(timer) };
}

export function createMcpManager(deps: McpManagerDeps): McpManager {
  const { repo, clock, log } = deps;
  const connect = deps.connect ?? connectMcp;
  const entries = new Map<string, Entry>();
  /** Per user: tools over the turn cap last time, so the warning is logged only on change. */
  const overCap = new Map<string, number>();

  const httpFor = (auth: AuthContext) => {
    const policy = endpointPolicy(auth.role);
    return policy.allowPrivate ? deps.http.endpointsPrivate : deps.http.endpoints;
  };

  const closeConn = async (entry: Entry) => {
    const conn = entry.conn;
    entry.conn = null;
    entry.connecting?.abort();
    entry.connecting = null;
    if (entry.idle) clearTimeout(entry.idle);
    entry.idle = null;
    if (conn) await conn.then((c) => c.close()).catch(() => {});
  };

  /** Restarts the idle timer; an unused connection is closed, its tool list kept. */
  const touch = (entry: Entry) => {
    if (entry.idle) clearTimeout(entry.idle);
    entry.idle = setTimeout(() => void closeConn(entry), MCP_IDLE_CLOSE_MS);
    entry.idle.unref?.();
  };

  const connection = (entry: Entry): Promise<McpConnection> => {
    touch(entry);
    if (entry.conn) return entry.conn;
    const controller = new AbortController();
    entry.connecting = controller;
    const { url, headers } = entry.config;
    const conn = connect(url, headers, entry.http, { signal: controller.signal });
    entry.conn = conn;
    conn.then(
      () => {
        if (entry.connecting === controller) entry.connecting = null;
      },
      () => {
        if (entry.conn === conn) entry.conn = null;
        if (entry.connecting === controller) entry.connecting = null;
      },
    );
    return conn;
  };

  const entryFor = (config: McpServerConfig, http: HttpClient): Entry => {
    const fingerprint = `${http === deps.http.endpointsPrivate}|${config.url}|${config.updatedAt}`;
    const existing = entries.get(config.id);
    if (existing && existing.fingerprint === fingerprint) {
      existing.config = config;
      return existing;
    }
    if (existing) void closeConn(existing);
    const entry: Entry = {
      config,
      fingerprint,
      http,
      conn: null,
      connecting: null,
      tools: null,
      fetchedAt: 0,
      refreshing: null,
      retryAt: 0,
      collided: 0,
      idle: null,
    };
    entries.set(config.id, entry);
    return entry;
  };

  const refresh = (entry: Entry): Promise<void> => {
    if (entry.refreshing) return entry.refreshing;
    const run = (async () => {
      try {
        const tools = await (await connection(entry)).listTools();
        entry.tools = tools;
        entry.fetchedAt = clock.now();
        touch(entry);
      } catch (err) {
        log.warn(
          { mcpServer: entry.config.id, err: errName(err) },
          'an MCP server could not list its tools; it is skipped',
        );
        entry.retryAt = clock.now() + MCP_RETRY_AFTER_MS;
        await closeConn(entry);
      } finally {
        entry.refreshing = null;
      }
    })();
    entry.refreshing = run;
    return run;
  };

  const callTool = async (
    serverId: string,
    fingerprint: string,
    toolName: string,
    args: unknown,
    signal: AbortSignal,
  ): Promise<ToolResult> => {
    const entry = entries.get(serverId);
    if (!entry || entry.fingerprint !== fingerprint) return { ok: false, error: CHANGED };
    try {
      return await (await connection(entry)).callTool(toolName, args, signal);
    } catch (err) {
      // A call that ran out of time leaves the session usable; anything else starts afresh.
      if (!signal.aborted) await closeConn(entry);
      throw err;
    } finally {
      touch(entry);
    }
  };

  /** The server's tools by tool name; names that collide after sanitizing are dropped. */
  const definitions = (entry: Entry, taken: Set<string>): ToolDefinition[] => {
    const { id, name } = entry.config;
    const { fingerprint } = entry;
    const sorted = [...(entry.tools ?? [])].sort((a, b) => compare(a.name, b.name));
    const defs: ToolDefinition[] = [];
    let dropped = 0;
    for (const tool of sorted) {
      const toolName = mcpToolName(name, tool.name);
      if (taken.has(toolName)) {
        dropped++;
        continue;
      }
      taken.add(toolName);
      defs.push({
        name: toolName,
        description: tool.description,
        parameters: tool.inputSchema,
        source: 'mcp',
        mcp: { server: name, tool: mcpToolLabel(tool.name) },
        defaultPolicy: 'ask',
        execute: (args, ctx) => callTool(id, fingerprint, tool.name, args, ctx.signal),
      });
    }
    if (dropped !== entry.collided && dropped > 0) {
      log.warn({ mcpServer: id, dropped }, 'MCP tool names collided; the later ones are skipped');
    }
    entry.collided = dropped;
    return defs;
  };

  /** Waits for a cold list unless the server failed or was too slow within the last minute. */
  const ready = async (entry: Entry, deadline: Promise<void>) => {
    if (entry.tools === null) {
      if (clock.now() < entry.retryAt) return;
      await Promise.race([refresh(entry), deadline]);
      if (entry.tools === null) entry.retryAt = clock.now() + MCP_RETRY_AFTER_MS;
    } else if (clock.now() - entry.fetchedAt >= MCP_TOOLS_TTL_MS && clock.now() >= entry.retryAt) {
      void refresh(entry);
    }
  };

  return {
    async toolsFor(auth) {
      const configs = repo
        .enabled(auth.userId, auth.dek)
        .sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id));
      if (configs.length === 0) return [];
      const http = httpFor(auth);
      // One deadline for every cold server of this turn, started before any wait.
      const wait = delay(MCP_LIST_WAIT_MS);
      try {
        const ordered = configs.map((config) => entryFor(config, http));
        await Promise.all(ordered.map((entry) => ready(entry, wait.done)));
        const taken = new Set<string>();
        const all = ordered.flatMap((entry) => definitions(entry, taken));
        const over = Math.max(0, all.length - MCP_TURN_MAX_TOOLS);
        if (over > 0 && over !== (overCap.get(auth.userId) ?? 0)) {
          log.warn({ dropped: over }, 'too many MCP tools for one turn; the last ones are skipped');
        }
        overCap.set(auth.userId, over);
        return all.slice(0, MCP_TURN_MAX_TOOLS);
      } finally {
        wait.cancel();
      }
    },

    async test(auth, id) {
      const config = repo.config(auth.userId, auth.dek, id);
      if (!config) throw new AppError('not_found', 'That MCP server does not exist.', 404);
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        deps.testTimeoutMs ?? MCP_REQUEST_TIMEOUT_MS,
      );
      let conn: McpConnection | null = null;
      try {
        conn = await connect(config.url, config.headers, httpFor(auth), {
          signal: controller.signal,
        });
        const tools = await conn.listTools(controller.signal);
        return {
          ok: true,
          tools: tools.map((t) => ({
            name: t.name.slice(0, TEST_NAME_MAX),
            description: t.description,
          })),
        };
      } catch (err) {
        return { ok: false, message: testMessage(err) };
      } finally {
        clearTimeout(timer);
        await conn?.close().catch(() => {});
      }
    },

    toolNames(serverId) {
      const entry = entries.get(serverId);
      if (!entry?.tools) return null;
      return entry.tools.map((tool) => mcpToolName(entry.config.name, tool.name));
    },

    invalidate(serverId) {
      const entry = entries.get(serverId);
      if (!entry) return;
      entries.delete(serverId);
      void closeConn(entry);
    },

    async closeAll() {
      const all = [...entries.values()];
      await Promise.allSettled(all.map(closeConn));
      await Promise.allSettled(all.map((e) => e.refreshing));
    },
  };
}
