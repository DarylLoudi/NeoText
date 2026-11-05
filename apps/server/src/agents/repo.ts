import { type AgentData, AgentDataSchema, type AgentPublic } from '@neotext/shared';
import { and, asc, count, eq } from 'drizzle-orm';
import { aad } from '../crypto/aad';
import { openJson, openText, sealJson, sealText } from '../crypto/aead';
import type { DbHandle } from '../db/client';
import { agents } from '../db/schema';
import type { Logger } from '../lib/logger';

/** Every method is scoped to one user: other users' rows look like they do not exist. */
export interface AgentsRepo {
  list(userId: string, dek: Buffer): AgentPublic[];
  get(userId: string, id: string, dek: Buffer): AgentPublic | null;
  insert(row: AgentPublic & { userId: string }, dek: Buffer): void;
  update(
    userId: string,
    id: string,
    patch: { name?: string; data?: AgentData; position?: string },
    at: number,
    dek: Buffer,
  ): void;
  count(userId: string): number;
  remove(userId: string, id: string): boolean;
}

type Row = typeof agents.$inferSelect;

/** The agent, or null when its name or data cannot be opened or no longer fits the schema. */
function toAgent(row: Row, dek: Buffer): AgentPublic | null {
  try {
    const data = AgentDataSchema.safeParse(
      openJson<unknown>(dek, row.data, aad('agents', 'data', row.id)),
    );
    if (!data.success) return null;
    return {
      id: row.id,
      name: openText(dek, row.name, aad('agents', 'name', row.id)),
      data: data.data,
      position: row.position,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  } catch {
    return null;
  }
}

export function createAgentsRepo(db: DbHandle, log?: Logger): AgentsRepo {
  const { orm } = db;
  /** Opens a row; a broken one is skipped and logged by id only. */
  const open = (row: Row, dek: Buffer): AgentPublic | null => {
    const agent = toAgent(row, dek);
    if (!agent) log?.warn({ agentId: row.id }, 'agent could not be read and was skipped');
    return agent;
  };
  const owned = (userId: string, id: string) => and(eq(agents.userId, userId), eq(agents.id, id));
  return {
    list: (userId, dek) =>
      orm
        .select()
        .from(agents)
        .where(eq(agents.userId, userId))
        .orderBy(asc(agents.position), asc(agents.id))
        .all()
        .flatMap((r) => open(r, dek) ?? []),
    get: (userId, id, dek) => {
      const row = orm.select().from(agents).where(owned(userId, id)).get();
      return row ? open(row, dek) : null;
    },
    insert: (row, dek) => {
      orm
        .insert(agents)
        .values({
          id: row.id,
          userId: row.userId,
          name: sealText(dek, row.name, aad('agents', 'name', row.id)),
          data: sealJson(dek, row.data, aad('agents', 'data', row.id)),
          position: row.position,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })
        .run();
    },
    update: (userId, id, patch, at, dek) => {
      const set: Partial<typeof agents.$inferInsert> = { updatedAt: at };
      if (patch.name !== undefined) {
        set.name = sealText(dek, patch.name, aad('agents', 'name', id));
      }
      if (patch.data !== undefined) {
        set.data = sealJson(dek, patch.data, aad('agents', 'data', id));
      }
      if (patch.position !== undefined) set.position = patch.position;
      orm.update(agents).set(set).where(owned(userId, id)).run();
    },
    count: (userId) =>
      orm.select({ n: count() }).from(agents).where(eq(agents.userId, userId)).get()?.n ?? 0,
    remove: (userId, id) => orm.delete(agents).where(owned(userId, id)).run().changes > 0,
  };
}
