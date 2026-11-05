import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  blob,
  index,
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import { users } from './auth';

export const folders = sqliteTable(
  'folders',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references((): AnySQLiteColumn => folders.id, {
      onDelete: 'set null',
    }),
    name: blob('name', { mode: 'buffer' }).notNull(),
    color: text('color'),
    position: text('position').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('folders_user_idx').on(t.userId)],
);

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    folderId: text('folder_id').references(() => folders.id, { onDelete: 'set null' }),
    title: blob('title', { mode: 'buffer' }),
    titleSource: text('title_source', { enum: ['none', 'auto', 'user'] })
      .notNull()
      .default('none'),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    pinPosition: text('pin_position'),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    presetId: text('preset_id'),
    modelRef: text('model_ref', { mode: 'json' }).$type<{ providerId: string; modelId: string }>(),
    activeLeafId: text('active_leaf_id'),
    messageCount: integer('message_count').notNull().default(0),
    importRef: text('import_ref'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    lastActivityAt: integer('last_activity_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    index('conversations_list_idx').on(
      t.userId,
      t.deletedAt,
      t.archived,
      sql`${t.lastActivityAt} desc`,
      sql`${t.id} desc`,
    ),
    index('conversations_pinned_idx').on(t.userId, t.pinned, t.pinPosition),
    index('conversations_folder_idx').on(t.userId, t.folderId),
  ],
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references((): AnySQLiteColumn => messages.id, {
      onDelete: 'cascade',
    }),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    status: text('status', {
      enum: ['complete', 'streaming', 'error', 'aborted', 'interrupted'],
    }).notNull(),
    parts: blob('parts', { mode: 'buffer' }).notNull(),
    providerId: text('provider_id'),
    modelId: text('model_id'),
    generationRef: text('generation_ref'),
    usage: text('usage', { mode: 'json' }),
    finishReason: text('finish_reason'),
    errorCode: text('error_code'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('messages_conversation_idx').on(t.conversationId, t.createdAt),
    index('messages_parent_idx').on(t.parentId),
  ],
);
