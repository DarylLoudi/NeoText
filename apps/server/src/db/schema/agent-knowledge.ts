import { blob, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { agents } from './agents';
import { users } from './auth';

/** One uploaded file of an agent's knowledge base. Only its extracted text is kept. */
export const agentFiles = sqliteTable(
  'agent_files',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Sealed text under the owner's DEK. */
    name: blob('name', { mode: 'buffer' }).notNull(),
    /** Bytes of the upload. */
    size: integer('size').notNull(),
    /** Pages of a PDF; null for other files. */
    pages: integer('pages'),
    chunks: integer('chunks').notNull(),
    /** UTF-8 bytes of the extracted text, counted against the user's knowledge cap. */
    textBytes: integer('text_bytes').notNull(),
    status: text('status', { enum: ['ready', 'failed'] }).notNull(),
    /** Why extraction failed, in our own words; never file content. */
    error: text('error'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('agent_files_agent_idx').on(t.agentId), index('agent_files_user_idx').on(t.userId)],
);

/** A piece of a file's extracted text; BM25 runs over these. */
export const agentChunks = sqliteTable(
  'agent_chunks',
  {
    id: text('id').primaryKey(),
    fileId: text('file_id')
      .notNull()
      .references(() => agentFiles.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    page: integer('page'),
    /** Sealed text under the owner's DEK. */
    text: blob('text', { mode: 'buffer' }).notNull(),
  },
  (t) => [
    index('agent_chunks_agent_idx').on(t.agentId),
    index('agent_chunks_file_idx').on(t.fileId),
  ],
);
