import { type AgentFile, newId } from '@neotext/shared';
import { and, asc, count, eq, sum } from 'drizzle-orm';
import { aad } from '../../crypto/aad';
import { openText, sealText } from '../../crypto/aead';
import type { DbHandle } from '../../db/client';
import { agentChunks, agentFiles } from '../../db/schema';
import type { Logger } from '../../lib/logger';

export interface NewAgentFile {
  id: string;
  agentId: string;
  userId: string;
  name: string;
  size: number;
  pages: number | null;
  textBytes: number;
  status: AgentFile['status'];
  error: string | null;
  createdAt: number;
  chunks: { page: number | null; text: string }[];
}

export interface KnowledgeChunk {
  id: string;
  fileId: string;
  page: number | null;
  text: string;
}

/** Every method is scoped to one user: other users' rows look like they do not exist. */
export interface KnowledgeRepo {
  list(userId: string, agentId: string, dek: Buffer): AgentFile[];
  /** Inserts the file and its chunks in one transaction, unless `allow()` says no inside it. */
  insert(file: NewAgentFile, dek: Buffer, allow: () => void): void;
  remove(userId: string, agentId: string, fileId: string): boolean;
  count(userId: string, agentId: string): number;
  readyCount(userId: string, agentId: string): number;
  /** Extracted text bytes over all of the user's files. */
  textBytes(userId: string): number;
  /** The agent's chunks, opened; a chunk that cannot be opened is skipped. */
  chunks(userId: string, agentId: string, dek: Buffer): KnowledgeChunk[];
}

type FileRow = typeof agentFiles.$inferSelect;

export function createKnowledgeRepo(db: DbHandle, log?: Logger): KnowledgeRepo {
  const { orm } = db;
  const ofAgent = (userId: string, agentId: string) =>
    and(eq(agentFiles.userId, userId), eq(agentFiles.agentId, agentId));
  const toFile = (row: FileRow, dek: Buffer): AgentFile | null => {
    try {
      return {
        id: row.id,
        agentId: row.agentId,
        name: openText(dek, row.name, aad('agent_files', 'name', row.id)),
        size: row.size,
        pages: row.pages,
        chunks: row.chunks,
        status: row.status,
        error: row.error,
        createdAt: row.createdAt,
      };
    } catch {
      log?.warn({ fileId: row.id }, 'knowledge file could not be read and was skipped');
      return null;
    }
  };
  return {
    list: (userId, agentId, dek) =>
      orm
        .select()
        .from(agentFiles)
        .where(ofAgent(userId, agentId))
        .orderBy(asc(agentFiles.createdAt), asc(agentFiles.id))
        .all()
        .flatMap((r) => toFile(r, dek) ?? []),
    insert: (file, dek, allow) => {
      db.raw.transaction(() => {
        allow();
        orm
          .insert(agentFiles)
          .values({
            id: file.id,
            agentId: file.agentId,
            userId: file.userId,
            name: sealText(dek, file.name, aad('agent_files', 'name', file.id)),
            size: file.size,
            pages: file.pages,
            chunks: file.chunks.length,
            textBytes: file.textBytes,
            status: file.status,
            error: file.error,
            createdAt: file.createdAt,
          })
          .run();
        file.chunks.forEach((chunk, seq) => {
          const id = newId('akc');
          orm
            .insert(agentChunks)
            .values({
              id,
              fileId: file.id,
              agentId: file.agentId,
              seq,
              page: chunk.page,
              text: sealText(dek, chunk.text, aad('agent_chunks', 'text', id)),
            })
            .run();
        });
      })();
    },
    remove: (userId, agentId, fileId) =>
      orm
        .delete(agentFiles)
        .where(and(ofAgent(userId, agentId), eq(agentFiles.id, fileId)))
        .run().changes > 0,
    count: (userId, agentId) =>
      orm.select({ n: count() }).from(agentFiles).where(ofAgent(userId, agentId)).get()?.n ?? 0,
    readyCount: (userId, agentId) =>
      orm
        .select({ n: count() })
        .from(agentFiles)
        .where(and(ofAgent(userId, agentId), eq(agentFiles.status, 'ready')))
        .get()?.n ?? 0,
    textBytes: (userId) =>
      Number(
        orm
          .select({ n: sum(agentFiles.textBytes) })
          .from(agentFiles)
          .where(eq(agentFiles.userId, userId))
          .get()?.n ?? 0,
      ),
    chunks: (userId, agentId, dek) =>
      orm
        .select({
          id: agentChunks.id,
          fileId: agentChunks.fileId,
          page: agentChunks.page,
          text: agentChunks.text,
        })
        .from(agentChunks)
        .innerJoin(agentFiles, eq(agentFiles.id, agentChunks.fileId))
        .where(and(ofAgent(userId, agentId), eq(agentFiles.status, 'ready')))
        .orderBy(asc(agentFiles.createdAt), asc(agentChunks.fileId), asc(agentChunks.seq))
        .all()
        .flatMap((r) => {
          try {
            const text = openText(dek, r.text, aad('agent_chunks', 'text', r.id));
            return [{ id: r.id, fileId: r.fileId, page: r.page, text }];
          } catch {
            log?.warn({ chunkId: r.id }, 'knowledge chunk could not be read and was skipped');
            return [];
          }
        }),
  };
}
