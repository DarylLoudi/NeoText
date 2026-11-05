import { blob, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export interface KdfParams {
  alg: 'argon2id';
  memoryKiB: number;
  passes: number;
  parallelism: number;
}

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    role: text('role', { enum: ['admin', 'member'] }).notNull(),
    status: text('status', { enum: ['active', 'disabled'] }).notNull(),
    kdfSalt: blob('kdf_salt', { mode: 'buffer' }).notNull(),
    kdfParams: text('kdf_params', { mode: 'json' }).$type<KdfParams>().notNull(),
    authVerifier: blob('auth_verifier', { mode: 'buffer' }).notNull(),
    dekByPassword: blob('dek_by_password', { mode: 'buffer' }).notNull(),
    dekByRecovery: blob('dek_by_recovery', { mode: 'buffer' }).notNull(),
    dekByInstance: blob('dek_by_instance', { mode: 'buffer' }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    passwordChangedAt: integer('password_changed_at').notNull(),
  },
  (t) => [uniqueIndex('users_username_unique').on(t.username)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dekWrapped: blob('dek_wrapped', { mode: 'buffer' }).notNull(),
    createdAt: integer('created_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);
