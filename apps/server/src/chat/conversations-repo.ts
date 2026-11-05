import type { ConversationSummary, ListQuery, ModelRef } from '@neotext/shared';
import { and, asc, desc, eq, gte, isNotNull, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import { aad } from '../crypto/aad';
import { openText, sealText } from '../crypto/aead';
import type { DbHandle } from '../db/client';
import { conversations } from '../db/schema';
import { AppError } from '../http/errors';

export interface ConversationPatch {
  title: string | null;
  titleSource: 'none' | 'auto' | 'user';
  folderId: string | null;
  pinned: boolean;
  pinPosition: string | null;
  archived: boolean;
  activeLeafId: string | null;
  modelRef: ModelRef | null;
  presetId: string | null;
  messageCount: number;
}

export interface ConversationsRepo {
  insert(
    row: {
      id: string;
      userId: string;
      folderId: string | null;
      title: string | null;
      presetId?: string | null;
      createdAt: number;
    },
    dek: Buffer,
  ): void;
  /** An imported chat: its own times and flags, plus `importRef` naming where it came from. */
  insertImported(
    row: Omit<ConversationSummary, 'activeLeafId' | 'messageCount' | 'deletedAt'> & {
      userId: string;
      importRef: string;
    },
    dek: Buffer,
  ): void;
  /** True when the user already has this import (trashed counts), or still has `originalId`. */
  hasImport(userId: string, importRef: string, originalId?: string): boolean;
  get(
    userId: string,
    id: string,
    dek: Buffer,
    opts?: { includeDeleted?: boolean },
  ): ConversationSummary | null;
  list(
    userId: string,
    dek: Buffer,
    q: ListQuery,
  ): { items: ConversationSummary[]; nextCursor: string | null };
  update(
    userId: string,
    id: string,
    patch: Partial<ConversationPatch>,
    at: number,
    dek: Buffer,
  ): void;
  recordTurn(
    id: string,
    at: number,
    activeLeafId: string,
    addedMessages: number,
    modelRef: ModelRef,
  ): void;
  touch(id: string, at: number): void;
  softDelete(userId: string, id: string, at: number): void;
  restore(userId: string, id: string, at: number): void;
  /**
   * Permanently deletes trashed conversations (their messages cascade) and returns the ids.
   * `userId` null means every user; `olderThan` keeps rows deleted at or after that time.
   */
  purge(userId: string | null, olderThan: number | null, id?: string): string[];
}

const PINNED_MAX = 500;
const SEARCH_SCAN_MAX = 2000;
const SEARCH_BATCH = 200;

type Row = typeof conversations.$inferSelect;

function toSummary(row: Row, dek: Buffer): ConversationSummary {
  return {
    id: row.id,
    title: row.title ? openText(dek, row.title, aad('conversations', 'title', row.id)) : null,
    titleSource: row.titleSource,
    folderId: row.folderId,
    pinned: row.pinned,
    pinPosition: row.pinPosition,
    archived: row.archived,
    presetId: row.presetId,
    modelRef: row.modelRef ?? null,
    activeLeafId: row.activeLeafId,
    messageCount: row.messageCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastActivityAt: row.lastActivityAt,
    deletedAt: row.deletedAt,
  };
}

const badCursor = () =>
  new AppError('bad_request', 'That page cursor is not valid. Reload the list and try again.', 400);

function encodeCursor(row: { lastActivityAt: number; id: string }): string {
  return Buffer.from(JSON.stringify([row.lastActivityAt, row.id])).toString('base64url');
}

function decodeCursor(cursor: string): [number, string] {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'number' &&
      Number.isFinite(value[0]) &&
      typeof value[1] === 'string'
    ) {
      return [value[0], value[1]];
    }
  } catch {
    // fall through to the error below
  }
  throw badCursor();
}

function scopeConditions(userId: string, q: ListQuery): SQL[] {
  const conds: SQL[] = [eq(conversations.userId, userId)];
  switch (q.scope) {
    case 'recent':
      conds.push(
        isNull(conversations.deletedAt),
        eq(conversations.archived, false),
        eq(conversations.pinned, false),
      );
      if (!q.includeFoldered) conds.push(isNull(conversations.folderId));
      break;
    case 'pinned':
      conds.push(
        isNull(conversations.deletedAt),
        eq(conversations.archived, false),
        eq(conversations.pinned, true),
      );
      break;
    case 'archived':
      conds.push(isNull(conversations.deletedAt), eq(conversations.archived, true));
      break;
    case 'folder':
      conds.push(isNull(conversations.deletedAt), eq(conversations.folderId, q.folderId ?? ''));
      break;
    case 'trash':
      conds.push(isNotNull(conversations.deletedAt));
      break;
    default:
      conds.push(isNull(conversations.deletedAt));
  }
  if (q.modelId)
    conds.push(sql`json_extract(${conversations.modelRef}, '$.modelId') = ${q.modelId}`);
  if (q.updatedSince !== undefined) conds.push(gte(conversations.updatedAt, q.updatedSince));
  return conds;
}

export function createConversationsRepo(db: DbHandle): ConversationsRepo {
  const { orm } = db;
  const owned = (userId: string, id: string) =>
    and(eq(conversations.userId, userId), eq(conversations.id, id));

  function listPinned(userId: string, dek: Buffer, q: ListQuery) {
    const rows = orm
      .select()
      .from(conversations)
      .where(and(...scopeConditions(userId, q)))
      .orderBy(asc(conversations.pinPosition), asc(conversations.id))
      .limit(PINNED_MAX)
      .all();
    const needle = q.titleContains?.toLowerCase();
    const items = rows
      .map((r) => toSummary(r, dek))
      .filter((s) => !needle || (s.title ?? '').toLowerCase().includes(needle));
    return { items, nextCursor: null };
  }

  return {
    insert: (row, dek) => {
      orm
        .insert(conversations)
        .values({
          id: row.id,
          userId: row.userId,
          folderId: row.folderId,
          presetId: row.presetId ?? null,
          title: row.title ? sealText(dek, row.title, aad('conversations', 'title', row.id)) : null,
          titleSource: row.title ? 'user' : 'none',
          createdAt: row.createdAt,
          updatedAt: row.createdAt,
          lastActivityAt: row.createdAt,
        })
        .run();
    },
    insertImported: (row, dek) => {
      orm
        .insert(conversations)
        .values({
          id: row.id,
          userId: row.userId,
          folderId: row.folderId,
          presetId: row.presetId,
          title: row.title ? sealText(dek, row.title, aad('conversations', 'title', row.id)) : null,
          titleSource: row.title ? row.titleSource : 'none',
          pinned: row.pinned,
          pinPosition: row.pinPosition,
          archived: row.archived,
          modelRef: row.modelRef,
          importRef: row.importRef,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          lastActivityAt: row.lastActivityAt,
        })
        .run();
    },
    hasImport: (userId, importRef, originalId) => {
      const match = or(
        eq(conversations.importRef, importRef),
        originalId === undefined ? undefined : eq(conversations.id, originalId),
      );
      const row = orm
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.userId, userId), match))
        .limit(1)
        .get();
      return row !== undefined;
    },
    get: (userId, id, dek, opts) => {
      const conds = [owned(userId, id)];
      if (!opts?.includeDeleted) conds.push(isNull(conversations.deletedAt));
      const row = orm
        .select()
        .from(conversations)
        .where(and(...conds))
        .get();
      return row ? toSummary(row, dek) : null;
    },
    list: (userId, dek, q) => {
      if (q.scope === 'pinned') return listPinned(userId, dek, q);
      const conds = scopeConditions(userId, q);
      if (q.cursor) {
        const [at, id] = decodeCursor(q.cursor);
        const after = or(
          lt(conversations.lastActivityAt, at),
          and(eq(conversations.lastActivityAt, at), lt(conversations.id, id)),
        );
        if (after) conds.push(after);
      }
      const needle = q.titleContains?.toLowerCase();
      const base = (where: SQL[], limit: number) =>
        orm
          .select()
          .from(conversations)
          .where(and(...where))
          .orderBy(desc(conversations.lastActivityAt), desc(conversations.id))
          .limit(limit);

      if (!needle) {
        const rows = base(conds, q.limit + 1).all();
        const page = rows.slice(0, q.limit);
        const last = page[page.length - 1];
        return {
          items: page.map((r) => toSummary(r, dek)),
          nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null,
        };
      }

      const items: ConversationSummary[] = [];
      let scanned = 0;
      let resume: { lastActivityAt: number; id: string } | null = null;
      let exhausted = false;
      while (scanned < SEARCH_SCAN_MAX && items.length <= q.limit) {
        const where = [...conds];
        if (resume) {
          const after = or(
            lt(conversations.lastActivityAt, resume.lastActivityAt),
            and(
              eq(conversations.lastActivityAt, resume.lastActivityAt),
              lt(conversations.id, resume.id),
            ),
          );
          if (after) where.push(after);
        }
        const batch = base(where, Math.min(SEARCH_BATCH, SEARCH_SCAN_MAX - scanned)).all();
        if (batch.length === 0) {
          exhausted = true;
          break;
        }
        for (const row of batch) {
          scanned++;
          resume = row;
          const summary = toSummary(row, dek);
          if ((summary.title ?? '').toLowerCase().includes(needle)) {
            items.push(summary);
            if (items.length > q.limit) break;
          }
        }
      }
      if (items.length > q.limit) {
        const page = items.slice(0, q.limit);
        const last = page[page.length - 1];
        return { items: page, nextCursor: last ? encodeCursor(last) : null };
      }
      // Scan cap reached: continue from the last row examined so no later chat is skipped.
      return { items, nextCursor: !exhausted && resume ? encodeCursor(resume) : null };
    },
    update: (userId, id, patch, at, dek) => {
      const set: Partial<typeof conversations.$inferInsert> = { updatedAt: at };
      if (patch.title !== undefined) {
        set.title =
          patch.title === null
            ? null
            : sealText(dek, patch.title, aad('conversations', 'title', id));
      }
      if (patch.titleSource !== undefined) set.titleSource = patch.titleSource;
      if (patch.folderId !== undefined) set.folderId = patch.folderId;
      if (patch.pinned !== undefined) set.pinned = patch.pinned;
      if (patch.pinPosition !== undefined) set.pinPosition = patch.pinPosition;
      if (patch.archived !== undefined) set.archived = patch.archived;
      if (patch.activeLeafId !== undefined) set.activeLeafId = patch.activeLeafId;
      if (patch.modelRef !== undefined) set.modelRef = patch.modelRef;
      if (patch.presetId !== undefined) set.presetId = patch.presetId;
      if (patch.messageCount !== undefined) set.messageCount = patch.messageCount;
      orm.update(conversations).set(set).where(owned(userId, id)).run();
    },
    recordTurn: (id, at, activeLeafId, addedMessages, modelRef) => {
      orm
        .update(conversations)
        .set({
          activeLeafId,
          modelRef,
          messageCount: sql`${conversations.messageCount} + ${addedMessages}`,
          lastActivityAt: at,
          updatedAt: at,
        })
        .where(eq(conversations.id, id))
        .run();
    },
    touch: (id, at) => {
      orm
        .update(conversations)
        .set({ lastActivityAt: at, updatedAt: at })
        .where(eq(conversations.id, id))
        .run();
    },
    softDelete: (userId, id, at) => {
      orm
        .update(conversations)
        .set({ deletedAt: at, updatedAt: at })
        .where(owned(userId, id))
        .run();
    },
    restore: (userId, id, at) => {
      orm
        .update(conversations)
        .set({ deletedAt: null, updatedAt: at })
        .where(owned(userId, id))
        .run();
    },
    purge: (userId, olderThan, id) => {
      const conds: SQL[] = [isNotNull(conversations.deletedAt)];
      if (userId !== null) conds.push(eq(conversations.userId, userId));
      if (olderThan !== null) conds.push(lt(conversations.deletedAt, olderThan));
      if (id !== undefined) conds.push(eq(conversations.id, id));
      return orm
        .delete(conversations)
        .where(and(...conds))
        .returning({ id: conversations.id })
        .all()
        .map((r) => r.id);
    },
  };
}
