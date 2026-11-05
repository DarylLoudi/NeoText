import { blob, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './auth';

export const agents = sqliteTable(
  'agents',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Sealed text under the owner's DEK. */
    name: blob('name', { mode: 'buffer' }).notNull(),
    /** Sealed JSON `AgentData` under the owner's DEK. */
    data: blob('data', { mode: 'buffer' }).notNull(),
    position: text('position').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('agents_user_idx').on(t.userId)],
);
