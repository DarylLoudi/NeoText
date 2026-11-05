import { blob, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const faviconCache = sqliteTable('favicon_cache', {
  host: text('host').primaryKey(),
  ok: integer('ok').notNull(),
  mime: text('mime'),
  data: blob('data', { mode: 'buffer' }),
  fetchedAt: integer('fetched_at').notNull(),
});
