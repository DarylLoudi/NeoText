import { blob, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './auth';

export const providers = sqliteTable(
  'providers',
  {
    id: text('id').primaryKey(),
    /** NULL means a shared provider, sealed with the instance key. */
    ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    category: text('category', { enum: ['llm', 'search'] })
      .notNull()
      .default('llm'),
    kind: text('kind', {
      enum: ['openrouter', 'openai-compatible', 'searxng', 'brave', 'tavily'],
    }).notNull(),
    name: text('name').notNull(),
    baseUrl: text('base_url').notNull(),
    apiKey: blob('api_key', { mode: 'buffer' }),
    keyHint: text('key_hint'),
    headers: blob('headers', { mode: 'buffer' }),
    manualModels: text('manual_models', { mode: 'json' }).$type<string[]>(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    position: text('position').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('providers_owner_idx').on(t.ownerUserId)],
);

export const modelCache = sqliteTable('model_cache', {
  providerId: text('provider_id')
    .primaryKey()
    .references(() => providers.id, { onDelete: 'cascade' }),
  fetchedAt: integer('fetched_at').notNull(),
  data: text('data').notNull(),
});
