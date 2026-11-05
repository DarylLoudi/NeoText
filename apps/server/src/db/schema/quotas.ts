import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './auth';

/** A member's own limit on shared providers; no row means they follow the instance default. */
export const quotas = sqliteTable('quotas', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** NULL is unlimited. */
  dailyUsd: real('daily_usd'),
  monthlyUsd: real('monthly_usd'),
  updatedAt: integer('updated_at').notNull(),
});
