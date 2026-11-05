import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { users } from './auth';

export const invites = sqliteTable(
  'invites',
  {
    id: text('id').primaryKey(),
    /** Hex HMAC-SHA256 of the normalized code under the instance key; the code is never stored. */
    codeHash: text('code_hash').notNull(),
    role: text('role', { enum: ['admin', 'member'] }).notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at').notNull(),
    usedBy: text('used_by').references(() => users.id, { onDelete: 'set null' }),
    usedAt: integer('used_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('invites_code_hash_unique').on(t.codeHash),
    index('invites_created_idx').on(t.createdAt),
  ],
);
