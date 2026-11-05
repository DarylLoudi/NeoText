import type { ModelInfo } from '@neotext/shared';
import { eq, isNull, or } from 'drizzle-orm';
import type { DbHandle } from '../db/client';
import { modelCache, providers } from '../db/schema';

export type ProviderRow = typeof providers.$inferSelect;
export type ProviderInsert = typeof providers.$inferInsert;

export interface ModelCacheEntry {
  fetchedAt: number;
  models: ModelInfo[];
}

export interface ProvidersRepo {
  visibleTo(userId: string): ProviderRow[];
  find(id: string): ProviderRow | null;
  insert(row: ProviderInsert): void;
  update(id: string, patch: Partial<ProviderInsert>): void;
  remove(id: string): void;
  readCache(providerId: string): ModelCacheEntry | null;
  writeCache(providerId: string, entry: ModelCacheEntry): void;
  clearCache(providerId: string): void;
}

export function createProvidersRepo(db: DbHandle): ProvidersRepo {
  const { orm } = db;
  return {
    visibleTo: (userId) =>
      orm
        .select()
        .from(providers)
        .where(or(eq(providers.ownerUserId, userId), isNull(providers.ownerUserId)))
        .orderBy(providers.position)
        .all(),
    find: (id) => orm.select().from(providers).where(eq(providers.id, id)).get() ?? null,
    insert: (row) => {
      orm.insert(providers).values(row).run();
    },
    update: (id, patch) => {
      orm.update(providers).set(patch).where(eq(providers.id, id)).run();
    },
    remove: (id) => {
      orm.delete(providers).where(eq(providers.id, id)).run();
    },
    readCache: (providerId) => {
      const row = orm.select().from(modelCache).where(eq(modelCache.providerId, providerId)).get();
      if (!row) return null;
      try {
        return { fetchedAt: row.fetchedAt, models: JSON.parse(row.data) as ModelInfo[] };
      } catch {
        return null;
      }
    },
    clearCache: (providerId) => {
      orm.delete(modelCache).where(eq(modelCache.providerId, providerId)).run();
    },
    writeCache: (providerId, entry) => {
      const values = { providerId, fetchedAt: entry.fetchedAt, data: JSON.stringify(entry.models) };
      orm
        .insert(modelCache)
        .values(values)
        .onConflictDoUpdate({
          target: modelCache.providerId,
          set: { fetchedAt: values.fetchedAt, data: values.data },
        })
        .run();
    },
  };
}
