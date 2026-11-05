import { blob, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './auth';

/**
 * Uploaded files; the bytes live sealed on disk at `<data>/attachments/<userId>/<id>.bin`.
 * `conversation_id` and `message_id` are plain columns, not foreign keys: rows must outlive the
 * conversation's cascade so the purge hook can still find and remove their files.
 */
export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Null until the upload is sent with a message. */
    conversationId: text('conversation_id'),
    messageId: text('message_id'),
    /** Sealed text under the owner's DEK. */
    name: blob('name', { mode: 'buffer' }).notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    /** Of the plaintext bytes. */
    sha256: text('sha256').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('attachments_user_idx').on(t.userId),
    index('attachments_conversation_idx').on(t.conversationId),
    index('attachments_orphan_idx').on(t.messageId, t.createdAt),
  ],
);
