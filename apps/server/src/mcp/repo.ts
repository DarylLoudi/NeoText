import {
  type CreateMcpServerBody,
  type McpServerPublic,
  newId,
  type UpdateMcpServerBody,
} from '@neotext/shared';
import { and, eq } from 'drizzle-orm';
import { aad } from '../crypto/aad';
import { openJson, sealJson } from '../crypto/aead';
import type { DbHandle } from '../db/client';
import { mcpServers } from '../db/schema';
import type { Clock } from '../lib/clock';

export type McpServerRow = typeof mcpServers.$inferSelect;

/** A server as the manager uses it, with its headers opened. */
export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  headers: Record<string, string>;
  updatedAt: number;
}

/** Every method is scoped to one user: other users' rows look like they do not exist. */
export interface McpRepo {
  list(userId: string): McpServerPublic[];
  get(userId: string, id: string): McpServerPublic | null;
  /** Enabled servers with headers opened, oldest first. */
  enabled(userId: string, dek: Buffer): McpServerConfig[];
  /** One server with headers opened, enabled or not. */
  config(userId: string, dek: Buffer, id: string): McpServerConfig | null;
  create(userId: string, dek: Buffer, body: CreateMcpServerBody): McpServerPublic;
  update(
    userId: string,
    dek: Buffer,
    id: string,
    body: UpdateMcpServerBody,
  ): McpServerPublic | null;
  remove(userId: string, id: string): boolean;
}

const headersAad = (id: string) => aad('mcp_servers', 'headers', id);

const toPublic = (row: McpServerRow): McpServerPublic => ({
  id: row.id,
  name: row.name,
  url: row.url,
  hasHeaders: row.headers !== null,
  enabled: row.enabled,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** No headers is stored as NULL, so `hasHeaders` means at least one is set. */
const sealHeaders = (dek: Buffer, id: string, headers: Record<string, string> | null) =>
  headers && Object.keys(headers).length > 0 ? sealJson(dek, headers, headersAad(id)) : null;

export function createMcpRepo(db: DbHandle, clock: Clock): McpRepo {
  const { orm } = db;
  const own = (userId: string, id: string) =>
    and(eq(mcpServers.userId, userId), eq(mcpServers.id, id));
  const find = (userId: string, id: string) =>
    orm.select().from(mcpServers).where(own(userId, id)).get() ?? null;
  const toConfig = (dek: Buffer, row: McpServerRow): McpServerConfig => ({
    id: row.id,
    name: row.name,
    url: row.url,
    headers: row.headers
      ? openJson<Record<string, string>>(dek, row.headers, headersAad(row.id))
      : {},
    updatedAt: row.updatedAt,
  });

  return {
    list: (userId) =>
      orm
        .select()
        .from(mcpServers)
        .where(eq(mcpServers.userId, userId))
        .orderBy(mcpServers.createdAt, mcpServers.id)
        .all()
        .map(toPublic),

    get: (userId, id) => {
      const row = find(userId, id);
      return row ? toPublic(row) : null;
    },

    enabled: (userId, dek) =>
      orm
        .select()
        .from(mcpServers)
        .where(and(eq(mcpServers.userId, userId), eq(mcpServers.enabled, true)))
        .orderBy(mcpServers.createdAt, mcpServers.id)
        .all()
        .map((row) => toConfig(dek, row)),

    config: (userId, dek, id) => {
      const row = find(userId, id);
      return row ? toConfig(dek, row) : null;
    },

    create: (userId, dek, body) => {
      const id = newId('mcp');
      const now = clock.now();
      orm
        .insert(mcpServers)
        .values({
          id,
          userId,
          name: body.name,
          url: body.url,
          headers: sealHeaders(dek, id, body.headers ?? null),
          enabled: true,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      return toPublic(find(userId, id) as McpServerRow);
    },

    update: (userId, dek, id, body) => {
      if (!find(userId, id)) return null;
      const patch: Partial<typeof mcpServers.$inferInsert> = { updatedAt: clock.now() };
      if (body.name !== undefined) patch.name = body.name;
      if (body.url !== undefined) patch.url = body.url;
      if (body.enabled !== undefined) patch.enabled = body.enabled;
      if (body.headers !== undefined) patch.headers = sealHeaders(dek, id, body.headers);
      orm.update(mcpServers).set(patch).where(own(userId, id)).run();
      const row = find(userId, id);
      return row ? toPublic(row) : null;
    },

    remove: (userId, id) => orm.delete(mcpServers).where(own(userId, id)).run().changes > 0,
  };
}
