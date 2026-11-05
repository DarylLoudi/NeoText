import { AGENT_FILE_MAX_BYTES, AGENT_FILES_MAX, type AgentFile, newId } from '@neotext/shared';
import type { AuthContext } from '../../http/env';
import { AppError } from '../../http/errors';
import type { Clock } from '../../lib/clock';
import type { Logger } from '../../lib/logger';
import { createSemaphore } from '../../lib/semaphore';
import type { AgentsService } from '../service';
import { rankChunks } from './bm25';
import { chunkPages } from './chunk';
import { extractText, KnowledgeError, knowledgeKind } from './extract';
import type { KnowledgeRepo } from './repo';

/** Extracted text one user may keep over all agents. */
export const KNOWLEDGE_TEXT_QUOTA = 100 * 1024 * 1024;
export const EXTRACT_TIMEOUT_MS = 30_000;
/** Chunks one search returns, and the characters they may take with their headers. */
export const SEARCH_TOP_K = 6;
export const SEARCH_MAX_CHARS = 8_000;
/** Room each result's `[n] file, p. N` header takes from `SEARCH_MAX_CHARS`. */
const HEADER_ALLOWANCE = 24;
/** Uploads extracted at once on this server; the rest wait their turn. */
const EXTRACT_PARALLEL = 2;
const MiB = 1024 * 1024;

export interface KnowledgeHit {
  file: string;
  page: number | null;
  text: string;
}

export interface KnowledgeService {
  list(auth: AuthContext, agentId: string): AgentFile[];
  /** Stores the file's text; a file that cannot be read is stored as `failed` with the reason. */
  add(
    auth: AuthContext,
    agentId: string,
    file: { name: string; mime: string; bytes: Buffer },
  ): Promise<AgentFile>;
  remove(auth: AuthContext, agentId: string, fileId: string): void;
  /** Turned away before the body is read: a missing agent, or one already holding the most files. */
  checkUpload(auth: AuthContext, agentId: string): void;
  hasReady(auth: AuthContext, agentId: string): boolean;
  fileNames(auth: AuthContext, agentId: string): string[];
  /** The best chunks for `query`, at most `SEARCH_MAX_CHARS` with their headers. */
  search(auth: AuthContext, agentId: string, query: string): KnowledgeHit[];
}

const NAME_MAX = 255;

/** A file name on one line, for the list and the system line that names the files. */
function oneLineName(name: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it strips.
  const clean = name.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\s]+/g, ' ').trim();
  return clean.slice(0, NAME_MAX) || 'file';
}

const tooMany = () =>
  new AppError(
    'knowledge_limit',
    `An agent can hold up to ${AGENT_FILES_MAX} files. Delete one to add another.`,
    409,
  );

export function createKnowledgeService(deps: {
  repo: KnowledgeRepo;
  agents: Pick<AgentsService, 'get'>;
  clock: Clock;
  log: Logger;
  textQuotaBytes?: number;
  timeoutMs?: number;
}): KnowledgeService {
  const { repo, clock, log } = deps;
  const quota = deps.textQuotaBytes ?? KNOWLEDGE_TEXT_QUOTA;
  const timeoutMs = deps.timeoutMs ?? EXTRACT_TIMEOUT_MS;
  const slots = createSemaphore(EXTRACT_PARALLEL);
  const needAgent = (auth: AuthContext, agentId: string) => {
    if (!deps.agents.get(auth, agentId)) {
      throw new AppError('not_found', 'That agent does not exist.', 404);
    }
  };
  const checkUpload = (auth: AuthContext, agentId: string) => {
    needAgent(auth, agentId);
    if (repo.count(auth.userId, agentId) >= AGENT_FILES_MAX) throw tooMany();
  };

  /** The file's chunks, or the reason it has none. */
  async function read(file: { name: string; mime: string; bytes: Buffer }) {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const { pages, pageCount } = await slots(() =>
        extractText(file.name, file.mime, file.bytes, signal),
      );
      return { ok: true as const, pageCount, chunks: chunkPages(pages) };
    } catch (err) {
      if (err instanceof KnowledgeError) return { ok: false as const, error: err.reason };
      log.warn({ err: err instanceof Error ? err.name : 'unknown' }, 'knowledge extraction failed');
      return { ok: false as const, error: 'This file could not be read.' };
    }
  }

  return {
    list: (auth, agentId) => {
      needAgent(auth, agentId);
      return repo.list(auth.userId, agentId, auth.dek);
    },
    checkUpload,
    add: async (auth, agentId, file) => {
      checkUpload(auth, agentId);
      if (!knowledgeKind(file.name, file.mime)) {
        throw new AppError(
          'knowledge_type',
          'This file type is not supported. Use PDF, Word (.docx), text, Markdown, CSV or HTML.',
          415,
        );
      }
      if (file.bytes.length > AGENT_FILE_MAX_BYTES) {
        throw new AppError(
          'knowledge_too_large',
          `Files can be up to ${AGENT_FILE_MAX_BYTES / MiB} MB. Split this one or pick a smaller file.`,
          413,
        );
      }
      const name = oneLineName(file.name);
      const result = await read({ ...file, name });
      const chunks = result.ok ? result.chunks : [];
      const textBytes = chunks.reduce((n, c) => n + Buffer.byteLength(c.text), 0);
      const created: AgentFile = {
        id: newId('akf'),
        agentId,
        name,
        size: file.bytes.length,
        pages: result.ok ? result.pageCount : null,
        chunks: chunks.length,
        status: result.ok ? 'ready' : 'failed',
        error: result.ok ? null : result.error,
        createdAt: clock.now(),
      };
      // Checked again with the insert: the agent may be gone, or full, after the extraction.
      repo.insert({ ...created, userId: auth.userId, textBytes, chunks }, auth.dek, () => {
        checkUpload(auth, agentId);
        if (repo.textBytes(auth.userId) + textBytes > quota) {
          throw new AppError(
            'knowledge_limit',
            `Your agents' files can hold up to ${Math.round(quota / MiB)} MB of text. Delete some files to add this one.`,
            409,
          );
        }
      });
      return created;
    },
    remove: (auth, agentId, fileId) => {
      if (!repo.remove(auth.userId, agentId, fileId)) {
        throw new AppError('not_found', 'That file does not exist.', 404);
      }
    },
    hasReady: (auth, agentId) => repo.readyCount(auth.userId, agentId) > 0,
    fileNames: (auth, agentId) =>
      repo
        .list(auth.userId, agentId, auth.dek)
        .filter((f) => f.status === 'ready')
        .map((f) => f.name),
    search: (auth, agentId, query) => {
      const names = new Map(repo.list(auth.userId, agentId, auth.dek).map((f) => [f.id, f.name]));
      const chunks = repo.chunks(auth.userId, agentId, auth.dek);
      const byId = new Map(chunks.map((c) => [c.id, c]));
      const hits: KnowledgeHit[] = [];
      let left = SEARCH_MAX_CHARS;
      for (const { id } of rankChunks(query, chunks, SEARCH_TOP_K)) {
        const chunk = byId.get(id);
        const file = chunk ? names.get(chunk.fileId) : undefined;
        if (!chunk || file === undefined) continue;
        const room = left - HEADER_ALLOWANCE - file.length;
        if (room <= 0) break;
        const text = chunk.text.length > room ? `${chunk.text.slice(0, room - 1)}…` : chunk.text;
        hits.push({ file, page: chunk.page, text });
        left -= HEADER_ALLOWANCE + file.length + text.length;
      }
      return hits;
    },
  };
}
