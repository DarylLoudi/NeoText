import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './auth';

export const usageEvents = sqliteTable(
  'usage_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id'),
    messageId: text('message_id'),
    providerId: text('provider_id').notNull(),
    modelId: text('model_id').notNull(),
    kind: text('kind', { enum: ['chat', 'title', 'tool', 'search'] }).notNull(),
    promptTokens: integer('prompt_tokens').notNull(),
    completionTokens: integer('completion_tokens').notNull(),
    reasoningTokens: integer('reasoning_tokens').notNull(),
    cachedTokens: integer('cached_tokens').notNull(),
    costUsd: real('cost_usd'),
    webSearchRequests: integer('web_search_requests').notNull(),
    generationRef: text('generation_ref'),
    /**
     * 1 when the provider was shared at the time of the call. Written once, so a shared
     * provider that is deleted later (its row is gone) still counts toward a member's quota.
     */
    shared: integer('shared', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('usage_events_user_idx').on(t.userId, t.createdAt)],
);
