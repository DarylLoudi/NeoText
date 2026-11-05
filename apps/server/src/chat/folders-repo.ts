import type { Folder } from '@neotext/shared';
import { and, asc, eq } from 'drizzle-orm';
import { aad } from '../crypto/aad';
import { openText, sealText } from '../crypto/aead';
import type { DbHandle } from '../db/client';
import { conversations, folders } from '../db/schema';

export interface FoldersRepo {
  list(userId: string, dek: Buffer): Folder[];
  get(userId: string, id: string, dek: Buffer): Folder | null;
  insert(row: Folder & { userId: string }, dek: Buffer): void;
  update(
    userId: string,
    id: string,
    patch: Partial<Pick<Folder, 'name' | 'parentId' | 'color' | 'position'>>,
    at: number,
    dek: Buffer,
  ): void;
  /**
   * Moves the folder's conversations and child folders to its parent (stamping them `at`, so
   * sync picks the move up), then deletes it.
   */
  remove(userId: string, id: string, at: number): void;
  /** 1 for a root folder; 0 when the folder does not exist. */
  depth(userId: string, id: string): number;
}

type FolderRow = typeof folders.$inferSelect;

function toFolder(row: FolderRow, dek: Buffer): Folder {
  return {
    id: row.id,
    parentId: row.parentId,
    name: openText(dek, row.name, aad('folders', 'name', row.id)),
    color: row.color,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createFoldersRepo(db: DbHandle): FoldersRepo {
  const { orm } = db;
  const owned = (userId: string, id: string) => and(eq(folders.userId, userId), eq(folders.id, id));
  return {
    list: (userId, dek) =>
      orm
        .select()
        .from(folders)
        .where(eq(folders.userId, userId))
        .orderBy(asc(folders.position), asc(folders.id))
        .all()
        .map((r) => toFolder(r, dek)),
    get: (userId, id, dek) => {
      const row = orm.select().from(folders).where(owned(userId, id)).get();
      return row ? toFolder(row, dek) : null;
    },
    insert: (row, dek) => {
      orm
        .insert(folders)
        .values({
          id: row.id,
          userId: row.userId,
          parentId: row.parentId,
          name: sealText(dek, row.name, aad('folders', 'name', row.id)),
          color: row.color,
          position: row.position,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })
        .run();
    },
    update: (userId, id, patch, at, dek) => {
      const set: Partial<typeof folders.$inferInsert> = { updatedAt: at };
      if (patch.name !== undefined) {
        set.name = sealText(dek, patch.name, aad('folders', 'name', id));
      }
      if (patch.parentId !== undefined) set.parentId = patch.parentId;
      if (patch.color !== undefined) set.color = patch.color;
      if (patch.position !== undefined) set.position = patch.position;
      orm.update(folders).set(set).where(owned(userId, id)).run();
    },
    remove: (userId, id, at) => {
      db.raw.transaction(() => {
        const row = orm.select().from(folders).where(owned(userId, id)).get();
        if (!row) return;
        orm
          .update(conversations)
          .set({ folderId: row.parentId, updatedAt: at })
          .where(and(eq(conversations.userId, userId), eq(conversations.folderId, id)))
          .run();
        orm
          .update(folders)
          .set({ parentId: row.parentId, updatedAt: at })
          .where(and(eq(folders.userId, userId), eq(folders.parentId, id)))
          .run();
        orm.delete(folders).where(owned(userId, id)).run();
      })();
    },
    depth: (userId, id) => {
      let depth = 0;
      let current: string | null = id;
      const seen = new Set<string>();
      while (current && !seen.has(current)) {
        seen.add(current);
        const row = orm
          .select({ parentId: folders.parentId })
          .from(folders)
          .where(owned(userId, current))
          .get();
        if (!row) break;
        depth++;
        current = row.parentId;
      }
      return depth;
    },
  };
}
