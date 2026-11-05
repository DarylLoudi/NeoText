import type {
  FinishReason,
  MessagePart,
  MessagePublic,
  MessageStatus,
  Usage,
} from '@neotext/shared';
import { asc, eq } from 'drizzle-orm';
import { aad } from '../crypto/aad';
import { openJson, sealJson } from '../crypto/aead';
import type { DbHandle } from '../db/client';
import { messages } from '../db/schema';

export interface MessageInsert {
  id: string;
  conversationId: string;
  userId: string;
  parentId: string | null;
  role: 'user' | 'assistant';
  status: MessageStatus;
  parts: MessagePart[];
  providerId: string | null;
  modelId: string | null;
  createdAt: number;
}

export interface MessagePatch {
  parts?: MessagePart[];
  status?: MessageStatus;
  usage?: Usage | null;
  finishReason?: FinishReason | null;
  errorCode?: string | null;
  generationRef?: string | null;
}

export interface MessagesRepo {
  insert(m: MessageInsert, dek: Buffer): void;
  update(id: string, patch: MessagePatch, at: number, dek: Buffer): void;
  get(id: string, dek: Buffer): (MessagePublic & { userId: string }) | null;
  listForConversation(conversationId: string, dek: Buffer): MessagePublic[];
  /**
   * The conversation's messages in the same stable order, from `offset`, decrypting one row at
   * a time as the caller pulls. A caller that stops early (a time budget) pays only for what
   * it read.
   */
  iterateForConversation(
    conversationId: string,
    dek: Buffer,
    offset?: number,
  ): Iterable<MessagePublic>;
  /** Marks every row still `streaming` as `interrupted`; returns how many changed. */
  markInterrupted(at: number): number;
  /** Ids from `leafId` up to the root, leaf first; plain columns only, nothing is opened. */
  pathIds(conversationId: string, leafId: string): string[];
}

/** Rows fetched (still sealed) per query while iterating. */
const ITERATE_PAGE = 50;

type MessageRow = typeof messages.$inferSelect;

function toPublic(row: MessageRow, dek: Buffer): MessagePublic & { userId: string } {
  return {
    id: row.id,
    userId: row.userId,
    conversationId: row.conversationId,
    parentId: row.parentId,
    role: row.role,
    status: row.status,
    parts: openJson<MessagePart[]>(dek, row.parts, aad('messages', 'parts', row.id)),
    model:
      row.providerId && row.modelId ? { providerId: row.providerId, modelId: row.modelId } : null,
    usage: (row.usage as Usage | null) ?? null,
    finishReason: (row.finishReason as FinishReason | null) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createMessagesRepo(db: DbHandle): MessagesRepo {
  const { orm } = db;
  return {
    insert: (m, dek) => {
      orm
        .insert(messages)
        .values({
          id: m.id,
          conversationId: m.conversationId,
          userId: m.userId,
          parentId: m.parentId,
          role: m.role,
          status: m.status,
          parts: sealJson(dek, m.parts, aad('messages', 'parts', m.id)),
          providerId: m.providerId,
          modelId: m.modelId,
          createdAt: m.createdAt,
          updatedAt: m.createdAt,
        })
        .run();
    },
    update: (id, patch, at, dek) => {
      const set: Partial<typeof messages.$inferInsert> = { updatedAt: at };
      if (patch.parts !== undefined) {
        set.parts = sealJson(dek, patch.parts, aad('messages', 'parts', id));
      }
      if (patch.status !== undefined) set.status = patch.status;
      if (patch.usage !== undefined) set.usage = patch.usage;
      if (patch.finishReason !== undefined) set.finishReason = patch.finishReason;
      if (patch.errorCode !== undefined) set.errorCode = patch.errorCode;
      if (patch.generationRef !== undefined) set.generationRef = patch.generationRef;
      orm.update(messages).set(set).where(eq(messages.id, id)).run();
    },
    get: (id, dek) => {
      const row = orm.select().from(messages).where(eq(messages.id, id)).get();
      return row ? toPublic(row, dek) : null;
    },
    listForConversation: (conversationId, dek) =>
      orm
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(asc(messages.createdAt), asc(messages.id))
        .all()
        .map((r) => {
          const { userId: _userId, ...rest } = toPublic(r, dek);
          return rest;
        }),
    iterateForConversation: function* (conversationId, dek, offset = 0) {
      let at = offset;
      for (;;) {
        const rows = orm
          .select()
          .from(messages)
          .where(eq(messages.conversationId, conversationId))
          .orderBy(asc(messages.createdAt), asc(messages.id))
          .limit(ITERATE_PAGE)
          .offset(at)
          .all();
        for (const row of rows) {
          const { userId: _userId, ...rest } = toPublic(row, dek);
          yield rest;
        }
        if (rows.length < ITERATE_PAGE) return;
        at += rows.length;
      }
    },
    pathIds: (conversationId, leafId) => {
      const parents = new Map(
        orm
          .select({ id: messages.id, parentId: messages.parentId })
          .from(messages)
          .where(eq(messages.conversationId, conversationId))
          .all()
          .map((r) => [r.id, r.parentId]),
      );
      const out: string[] = [];
      for (let at: string | null | undefined = leafId; at && parents.has(at); ) {
        out.push(at);
        at = parents.get(at);
        if (out.length > parents.size) break;
      }
      return out;
    },
    markInterrupted: (at) =>
      orm
        .update(messages)
        .set({ status: 'interrupted', updatedAt: at })
        .where(eq(messages.status, 'streaming'))
        .run().changes,
  };
}
