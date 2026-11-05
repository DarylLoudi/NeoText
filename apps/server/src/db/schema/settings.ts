import { blob, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './auth';

export const userSettings = sqliteTable('user_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  data: blob('data', { mode: 'buffer' }).notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const userSettingsHistory = sqliteTable(
  'user_settings_history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    data: blob('data', { mode: 'buffer' }).notNull(),
    reason: text('reason', { enum: ['autosave', 'restore', 'migration', 'quarantine'] }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('user_settings_history_user_version_idx').on(t.userId, t.version)],
);
