import { createHash } from 'node:crypto';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_UNAVAILABLE_ID,
  type AttachmentPublic,
  attachmentKind,
  type MessagePart,
  newId,
  normalizeAttachmentMime,
} from '@neotext/shared';
import type { AuthContext } from '../http/env';
import { AppError } from '../http/errors';
import type { Clock } from '../lib/clock';
import type { Logger } from '../lib/logger';
import { type LoadedAttachment, TEXT_READ_BYTES, toModelFile } from './model-file';
import { storageQuota } from './quota';
import type { AttachmentRecord, AttachmentRef, AttachmentsRepo } from './repo';
import { sniffContent } from './sniff';
import type { AttachmentStore } from './store';

export type AttachmentPart = Extract<MessagePart, { type: 'attachment' }>;

export interface AttachmentFile {
  name: string;
  mime: string;
  bytes: Buffer;
}

export interface AttachmentsService {
  upload(auth: AuthContext, file: AttachmentFile): Promise<AttachmentPublic>;
  /** 413 when `bytes` more would take this user past the storage cap. */
  checkQuota(auth: AuthContext, bytes: number): void;
  /** 404 when missing or not the user's. */
  get(auth: AuthContext, id: string): AttachmentPublic;
  read(auth: AuthContext, id: string): Promise<{ attachment: AttachmentPublic; bytes: Buffer }>;
  /**
   * A strong validator for one upload of this user, 404 otherwise: a hash of its id and its
   * content hash, so a browser can revalidate without the file being opened. No key goes in.
   */
  etag(auth: AuthContext, id: string): string;
  /**
   * Links unused uploads of this user to a message and returns its parts; 400 otherwise.
   * Synchronous, so it runs inside the turn's transaction.
   */
  attach(
    auth: AuthContext,
    ids: string[],
    conversationId: string,
    messageId: string,
  ): AttachmentPart[];
  /**
   * Copies an upload of this user under a new id, as an unsent upload (it gets linked later by
   * `attach`). Async I/O, outside any transaction. Null when the source or its file is gone.
   */
  copyAsUpload(auth: AuthContext, sourceId: string): Promise<AttachmentPublic | null>;
  /**
   * For an edited message: uploads already sent in this conversation are copied so the new
   * message gets its own. Others pass through (`attach` judges them). `copied` lists the new
   * ids, for `discard` if the turn fails. A sent upload whose file is gone is left out of
   * `ids` and comes back in `unavailable`, as a part to keep on the new message.
   */
  prepareReuse(
    auth: AuthContext,
    ids: string[],
    conversationId: string | null,
  ): Promise<{ ids: string[]; copied: string[]; unavailable: AttachmentPart[] }>;
  /** Removes these uploads, files and rows. Never throws. */
  discard(auth: AuthContext, ids: string[]): void;
  /**
   * Opens a turn's files for the model within `TURN_ATTACHMENT_BUDGET` of stored bytes: the new
   * message's uploads first, then messages newest first (`messageIds` leaf first). Files past
   * the budget are `over-budget` and never read. Reads are async, a few at a time; each file's
   * AEAD open is synchronous, bounded by the 20 MiB file limit.
   */
  loadForTurn(
    auth: AuthContext,
    files: { uploadIds: string[]; messageIds: string[] },
  ): Promise<Map<string, LoadedAttachment | 'over-budget' | null>>;
  /** Best effort: removes the user's folder of files (account deletion). Never throws. */
  removeUserFiles(userId: string): Promise<void>;
  /** Removes the files of conversations deleted forever. Never throws. */
  purgeForConversations(conversationIds: string[]): void;
  /**
   * Removes uploads never sent with a message created before `olderThan`, and files whose
   * conversation no longer exists.
   */
  purgeOrphans(olderThan: number): number;
}

const NAME_MAX = 255;
/**
 * Stored bytes one turn reads (each file is read and opened whole, text included); older files
 * past it become a note.
 */
export const TURN_ATTACHMENT_BUDGET = 50 * 1024 * 1024;
/** Files read and opened at once while a turn loads. */
const READ_CONCURRENCY = 4;

/** Runs `fn` over `items`, at most `limit` at a time. */
async function eachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next] as T;
      next += 1;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** A display name only: never a path. Control characters and separators are dropped. */
function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned === '' ? 'file' : cleaned.slice(0, NAME_MAX);
}

const unsupported = () =>
  new AppError('unsupported_media_type', "This file type isn't supported.", 415);
const mismatch = () =>
  new AppError('unsupported_media_type', "This file's content doesn't match its type.", 415, {
    reason: 'content_mismatch',
  });
const notFound = () => new AppError('not_found', 'That file does not exist.', 404);
const notUsable = () =>
  new AppError(
    'bad_request',
    "One of the attached files can't be used. Remove it and upload it again.",
    400,
  );

/** The stored type for these bytes, or the 415 that explains why there is none. */
function checkedMime(file: AttachmentFile): string {
  const mime = normalizeAttachmentMime(file.name, file.mime);
  const kind = mime ? attachmentKind(mime) : null;
  if (!mime || !kind) throw unsupported();
  const sniffed = sniffContent(file.bytes);
  const agrees = kind === 'text' ? sniffed === 'text' : sniffed === mime;
  if (!agrees) throw mismatch();
  return mime;
}

const toPublic = (r: AttachmentRecord): AttachmentPublic => ({
  id: r.id,
  name: r.name,
  mime: r.mime,
  size: r.size,
  createdAt: r.createdAt,
});
const toPart = (r: AttachmentPublic): AttachmentPart => ({
  type: 'attachment',
  attachmentId: r.id,
  name: r.name,
  mime: r.mime,
  size: r.size,
});

export function createAttachmentsService(deps: {
  repo: AttachmentsRepo;
  store: AttachmentStore;
  clock: Clock;
  log: Logger;
  /** Stored file bytes one user may keep; defaults to `DEFAULT_ATTACHMENT_QUOTA_BYTES`. */
  quotaBytes?: number;
}): AttachmentsService {
  const { repo, store, clock, log } = deps;
  const checkQuota = storageQuota(repo, deps.quotaBytes);

  const find = (auth: AuthContext, id: string) => {
    const found = repo.get(auth.userId, id, auth.dek);
    if (!found) throw notFound();
    return found;
  };

  /**
   * Files first, then only the rows whose file went: a file that could not be removed keeps
   * its row, so the next sweep tries again.
   */
  function removeAll(refs: AttachmentRef[]): number {
    const removed: string[] = [];
    for (const ref of refs) {
      try {
        store.remove(ref.userId, ref.id);
        removed.push(ref.id);
      } catch (err) {
        log.error({ err, attachmentId: ref.id }, 'attachment file removal failed');
      }
    }
    repo.removeRows(removed);
    const left = refs.length - removed.length;
    if (left > 0) log.warn({ left, removed: removed.length }, 'some files were left for later');
    return removed.length;
  }

  async function copyAsUpload(auth: AuthContext, sourceId: string) {
    const source = repo.get(auth.userId, sourceId, auth.dek);
    if (!source) return null;
    let bytes: Buffer;
    try {
      bytes = await store.read(auth.userId, source.id, auth.dek);
    } catch (err) {
      log.warn({ err, attachmentId: source.id }, 'attachment file could not be copied');
      return null;
    }
    const record: AttachmentRecord = {
      ...source,
      id: newId('att'),
      conversationId: null,
      messageId: null,
      createdAt: clock.now(),
    };
    try {
      await store.write(auth.userId, record.id, bytes, auth.dek);
      repo.insert(record, auth.dek);
    } catch (err) {
      // A write that failed part way may have left a file; the id is new, so it is ours.
      try {
        store.remove(auth.userId, record.id);
      } catch (cleanup) {
        log.error({ err: cleanup, attachmentId: record.id }, 'partial copy removal failed');
      }
      throw err;
    }
    return toPublic(record);
  }

  return {
    upload: async (auth, file) => {
      if (file.bytes.length === 0) {
        throw new AppError('bad_request', 'That file is empty. Pick a file with content.', 400);
      }
      if (file.bytes.length > ATTACHMENT_MAX_BYTES) {
        throw new AppError('payload_too_large', 'Files can be up to 20 MB.', 413);
      }
      const mime = checkedMime(file);
      // Checked again with the real size; two uploads at once may both pass, by at most a file.
      checkQuota(auth, file.bytes.length);
      const record: AttachmentRecord = {
        id: newId('att'),
        userId: auth.userId,
        conversationId: null,
        messageId: null,
        name: cleanName(file.name),
        mime,
        size: file.bytes.length,
        sha256: createHash('sha256').update(file.bytes).digest('hex'),
        createdAt: clock.now(),
      };
      await store.write(auth.userId, record.id, file.bytes, auth.dek);
      try {
        repo.insert(record, auth.dek);
      } catch (err) {
        store.remove(auth.userId, record.id);
        throw err;
      }
      return toPublic(record);
    },

    checkQuota,

    get: (auth, id) => toPublic(find(auth, id)),

    read: async (auth, id) => {
      const record = find(auth, id);
      let bytes: Buffer;
      try {
        bytes = await store.read(auth.userId, id, auth.dek);
      } catch (err) {
        log.warn({ err, attachmentId: id }, 'attachment file could not be read');
        throw notFound();
      }
      return { attachment: toPublic(record), bytes };
    },

    etag: (auth, id) => {
      const record = find(auth, id);
      const tag = createHash('sha256').update(`${record.id}:${record.sha256}`).digest('base64url');
      return `"${tag.slice(0, 32)}"`;
    },

    attach: (auth, ids, conversationId, messageId) => {
      const unique = [...new Set(ids)];
      const records = unique.map((id) => {
        const found = repo.get(auth.userId, id, auth.dek);
        if (!found || found.messageId !== null) throw notUsable();
        return found;
      });
      if (repo.markAttached(auth.userId, unique, conversationId, messageId) !== unique.length) {
        throw notUsable();
      }
      return records.map((r) => toPart(toPublic(r)));
    },

    copyAsUpload,

    prepareReuse: async (auth, ids, conversationId) => {
      const out: string[] = [];
      const copied: string[] = [];
      const unavailable: AttachmentPart[] = [];
      try {
        for (const id of ids) {
          const found = conversationId ? repo.get(auth.userId, id, auth.dek) : null;
          if (!found || found.messageId === null || found.conversationId !== conversationId) {
            out.push(id);
            continue;
          }
          const copy = await copyAsUpload(auth, id);
          if (copy) {
            copied.push(copy.id);
            out.push(copy.id);
          } else {
            // Its file vanished: the edit keeps the name, like a fork does.
            unavailable.push({
              ...toPart(toPublic(found)),
              attachmentId: ATTACHMENT_UNAVAILABLE_ID,
            });
          }
        }
      } catch (err) {
        removeAll(copied.map((id) => ({ id, userId: auth.userId })));
        throw err;
      }
      return { ids: out, copied, unavailable };
    },

    discard: (auth, ids) => {
      try {
        removeAll(ids.map((id) => ({ id, userId: auth.userId })));
      } catch (err) {
        log.error({ err, count: ids.length }, 'discarding uploads failed');
      }
    },

    loadForTurn: async (auth, files) => {
      const out = new Map<string, LoadedAttachment | 'over-budget' | null>();
      const uploads = repo.byIds(auth.userId, files.uploadIds, auth.dek);
      const order = new Map(files.messageIds.map((id, i) => [id, i]));
      const rank = (r: AttachmentRecord) => order.get(r.messageId ?? '') ?? 0;
      const older = repo
        .forMessages(auth.userId, files.messageIds, auth.dek)
        .sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt);
      let used = 0;
      const picked: AttachmentRecord[] = [];
      for (const r of [...uploads, ...older]) {
        if (out.has(r.id)) continue;
        // Full stored size, text too: a sealed file is read and opened whole.
        if (used + r.size > TURN_ATTACHMENT_BUDGET) {
          out.set(r.id, 'over-budget');
          continue;
        }
        used += r.size;
        picked.push(r);
        out.set(r.id, null);
      }
      await eachLimited(picked, READ_CONCURRENCY, async (r) => {
        try {
          let bytes = await store.read(auth.userId, r.id, auth.dek);
          if (attachmentKind(r.mime) === 'text' && bytes.length > TEXT_READ_BYTES + 1) {
            // Only the head is sent; a copy of it lets the full plaintext be freed now.
            bytes = Buffer.from(bytes.subarray(0, TEXT_READ_BYTES + 1));
          }
          out.set(r.id, toModelFile(r.name, r.mime, bytes));
        } catch (err) {
          log.warn({ err, attachmentId: r.id }, 'attachment file could not be read');
        }
      });
      return out;
    },

    removeUserFiles: async (userId) => {
      try {
        await store.removeUser(userId);
      } catch (err) {
        log.error({ err, userId }, 'removing the user files failed');
      }
    },

    purgeForConversations: (conversationIds) => {
      try {
        const removed = removeAll(repo.forConversations(conversationIds));
        if (removed > 0) {
          log.info({ conversations: conversationIds.length, removed }, 'removed attachments');
        }
      } catch (err) {
        log.error({ err, conversations: conversationIds.length }, 'attachment purge failed');
      }
    },

    purgeOrphans: (olderThan) => {
      const refs = new Map<string, AttachmentRef>();
      for (const r of [...repo.orphans(olderThan), ...repo.dangling()]) refs.set(r.id, r);
      const removed = removeAll([...refs.values()]);
      if (removed > 0) log.info({ removed }, 'removed unsent or stranded uploads');
      return removed;
    },
  };
}
