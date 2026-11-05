import type { AttachmentPublic } from '@neotext/shared';
import { and, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { aad } from '../crypto/aad';
import { openText, sealText } from '../crypto/aead';
import type { DbHandle } from '../db/client';
import { attachments, conversations } from '../db/schema';

export interface AttachmentRecord extends AttachmentPublic {
  userId: string;
  conversationId: string | null;
  messageId: string | null;
  sha256: string;
}

/** A file to remove: rows carry no plaintext the purge needs. */
export interface AttachmentRef {
  id: string;
  userId: string;
}

export interface AttachmentsRepo {
  insert(row: AttachmentRecord, dek: Buffer): void;
  /** Scoped to the owner: another user's row looks like it does not exist. */
  get(userId: string, id: string, dek: Buffer): AttachmentRecord | null;
  /** Links unused uploads to a message; returns how many rows changed. */
  markAttached(userId: string, ids: string[], conversationId: string, messageId: string): number;
  /** The user's rows among `ids`; missing ones are left out. */
  byIds(userId: string, ids: string[], dek: Buffer): AttachmentRecord[];
  /** The user's rows linked to any of these messages. */
  forMessages(userId: string, messageIds: string[], dek: Buffer): AttachmentRecord[];
  forConversations(conversationIds: string[]): AttachmentRef[];
  /** Rows whose conversation no longer exists (a delete that skipped the purge hook). */
  dangling(): AttachmentRef[];
  /** Uploads never sent with a message, created before `olderThan`. */
  orphans(olderThan: number): AttachmentRef[];
  removeRows(ids: string[]): void;
  /** Bytes of every file this user has stored, sent or not. */
  storedBytes(userId: string): number;
}

type Row = typeof attachments.$inferSelect;

/** SQLite's default bound-variable limit is 999; stay well under it. */
const CHUNK = 500;
function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

function toRecord(row: Row, dek: Buffer): AttachmentRecord {
  return {
    id: row.id,
    userId: row.userId,
    conversationId: row.conversationId,
    messageId: row.messageId,
    name: openText(dek, row.name, aad('attachments', 'name', row.id)),
    mime: row.mime,
    size: row.size,
    sha256: row.sha256,
    createdAt: row.createdAt,
  };
}

export function createAttachmentsRepo(db: DbHandle): AttachmentsRepo {
  const { orm } = db;
  const refs = { id: attachments.id, userId: attachments.userId };
  return {
    insert: (row, dek) => {
      orm
        .insert(attachments)
        .values({
          id: row.id,
          userId: row.userId,
          conversationId: row.conversationId,
          messageId: row.messageId,
          name: sealText(dek, row.name, aad('attachments', 'name', row.id)),
          mime: row.mime,
          size: row.size,
          sha256: row.sha256,
          createdAt: row.createdAt,
        })
        .run();
    },
    get: (userId, id, dek) => {
      const row = orm
        .select()
        .from(attachments)
        .where(and(eq(attachments.id, id), eq(attachments.userId, userId)))
        .get();
      return row ? toRecord(row, dek) : null;
    },
    markAttached: (userId, ids, conversationId, messageId) =>
      ids.length === 0
        ? 0
        : orm
            .update(attachments)
            .set({ conversationId, messageId })
            .where(
              and(
                inArray(attachments.id, ids),
                eq(attachments.userId, userId),
                isNull(attachments.messageId),
              ),
            )
            .run().changes,
    byIds: (userId, ids, dek) =>
      chunks([...new Set(ids)]).flatMap((part) =>
        orm
          .select()
          .from(attachments)
          .where(and(inArray(attachments.id, part), eq(attachments.userId, userId)))
          .all()
          .map((r) => toRecord(r, dek)),
      ),
    forMessages: (userId, messageIds, dek) =>
      chunks([...new Set(messageIds)]).flatMap((part) =>
        orm
          .select()
          .from(attachments)
          .where(and(inArray(attachments.messageId, part), eq(attachments.userId, userId)))
          .all()
          .map((r) => toRecord(r, dek)),
      ),
    dangling: () =>
      orm
        .select(refs)
        .from(attachments)
        .where(
          and(
            isNotNull(attachments.conversationId),
            sql`not exists (select 1 from ${conversations} where ${conversations.id} = ${attachments.conversationId})`,
          ),
        )
        .all(),
    forConversations: (conversationIds) =>
      chunks(conversationIds).flatMap((part) =>
        orm.select(refs).from(attachments).where(inArray(attachments.conversationId, part)).all(),
      ),
    orphans: (olderThan) =>
      orm
        .select(refs)
        .from(attachments)
        .where(and(isNull(attachments.messageId), lt(attachments.createdAt, olderThan)))
        .all(),
    storedBytes: (userId) =>
      orm
        .select({ total: sql<number>`coalesce(sum(${attachments.size}), 0)` })
        .from(attachments)
        .where(eq(attachments.userId, userId))
        .get()?.total ?? 0,
    removeRows: (ids) => {
      for (const part of chunks(ids)) {
        orm.delete(attachments).where(inArray(attachments.id, part)).run();
      }
    },
  };
}
