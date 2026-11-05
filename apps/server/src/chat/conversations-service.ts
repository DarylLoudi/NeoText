import {
  type ConversationDetail,
  type ConversationSummary,
  type CreateFolderBody,
  type Folder,
  type ListConversationsResponse,
  type ListQuery,
  newId,
  type UpdateConversationBody,
  type UpdateFolderBody,
} from '@neotext/shared';
import type { AttachmentsService } from '../attachments/service';
import type { DbHandle } from '../db/client';
import type { AuthContext } from '../http/env';
import { AppError } from '../http/errors';
import type { Clock } from '../lib/clock';
import type { ConversationPatch, ConversationsRepo } from './conversations-repo';
import type { FoldersRepo } from './folders-repo';
import { forkConversation } from './fork';
import type { MessagesRepo } from './messages-repo';

export const MAX_FOLDER_DEPTH = 3;

export interface ConversationsService {
  list(auth: AuthContext, q: ListQuery): ListConversationsResponse;
  create(
    auth: AuthContext,
    body: { title?: string; folderId?: string | null },
  ): ConversationSummary;
  detail(auth: AuthContext, id: string): ConversationDetail;
  update(auth: AuthContext, id: string, body: UpdateConversationBody): ConversationSummary;
  remove(auth: AuthContext, id: string): void;
  restore(auth: AuthContext, id: string): ConversationSummary;
  /** Permanently deletes a chat that is already in the trash. */
  deleteForever(auth: AuthContext, id: string): void;
  /** Permanently deletes everything in this user's trash. */
  emptyTrash(auth: AuthContext): { purged: number };
  /** Copies the path root to `messageId` into a new chat. */
  fork(auth: AuthContext, id: string, messageId: string): Promise<ConversationSummary>;
  listFolders(auth: AuthContext): Folder[];
  createFolder(auth: AuthContext, body: CreateFolderBody): Folder;
  updateFolder(auth: AuthContext, id: string, body: UpdateFolderBody): Folder;
  removeFolder(auth: AuthContext, id: string): void;
}

const conversationNotFound = () =>
  new AppError('not_found', 'That conversation does not exist.', 404);
const folderNotFound = () => new AppError('not_found', 'That folder does not exist.', 404);

export function createConversationsService(deps: {
  db: DbHandle;
  conversations: ConversationsRepo;
  messages: MessagesRepo;
  folders: FoldersRepo;
  /** Copies attached files into forks. */
  attachments: Pick<AttachmentsService, 'copyAsUpload' | 'attach' | 'discard'>;
  clock: Clock;
  /** Called with the ids of conversations deleted forever, so related data can be cleaned up. */
  onPurged?: (ids: string[]) => void;
}): ConversationsService {
  const { db, conversations, messages, folders, clock } = deps;
  const onPurged = deps.onPurged ?? (() => {});

  function requireConversation(auth: AuthContext, id: string, includeDeleted = false) {
    const found = conversations.get(auth.userId, id, auth.dek, { includeDeleted });
    if (!found) throw conversationNotFound();
    return found;
  }

  function requireFolder(auth: AuthContext, id: string): Folder {
    const found = folders.get(auth.userId, id, auth.dek);
    if (!found) throw folderNotFound();
    return found;
  }

  function tooDeep(): AppError {
    return new AppError(
      'bad_request',
      `Folders can be nested at most ${MAX_FOLDER_DEPTH} levels deep. Pick a higher-level parent.`,
      400,
    );
  }

  /** Levels in the subtree rooted at `id`, counting `id` itself as 1. */
  function subtreeHeight(all: Folder[], id: string): number {
    const children = all.filter((f) => f.parentId === id);
    return 1 + Math.max(0, ...children.map((c) => subtreeHeight(all, c.id)));
  }

  function isDescendant(all: Folder[], ancestorId: string, candidateId: string): boolean {
    let current: string | null = candidateId;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      if (current === ancestorId) return true;
      seen.add(current);
      current = all.find((f) => f.id === current)?.parentId ?? null;
    }
    return false;
  }

  return {
    list: (auth, q) => {
      if (q.scope === 'folder') {
        if (!q.folderId) {
          throw new AppError('bad_request', 'Pick a folder to list its conversations.', 400);
        }
        requireFolder(auth, q.folderId);
      }
      return conversations.list(auth.userId, auth.dek, q);
    },

    create: (auth, body) => {
      if (body.folderId) requireFolder(auth, body.folderId);
      const id = newId('cnv');
      conversations.insert(
        {
          id,
          userId: auth.userId,
          folderId: body.folderId ?? null,
          title: body.title ?? null,
          createdAt: clock.now(),
        },
        auth.dek,
      );
      return requireConversation(auth, id);
    },

    detail: (auth, id) => ({
      conversation: requireConversation(auth, id),
      messages: messages.listForConversation(id, auth.dek),
    }),

    update: (auth, id, body) => {
      const current = requireConversation(auth, id);
      const patch: Partial<ConversationPatch> = {};
      if (body.title !== undefined) {
        patch.title = body.title;
        patch.titleSource = 'user';
      }
      if (body.folderId !== undefined) {
        if (body.folderId !== null) requireFolder(auth, body.folderId);
        patch.folderId = body.folderId;
      }
      if (body.pinned !== undefined) {
        patch.pinned = body.pinned;
        if (!body.pinned) patch.pinPosition = null;
        else if (body.pinPosition === undefined && current.pinPosition === null) {
          patch.pinPosition = String(clock.now()).padStart(16, '0');
        }
      }
      if (body.pinPosition !== undefined) patch.pinPosition = body.pinPosition;
      if (body.archived !== undefined) patch.archived = body.archived;
      if (body.activeLeafId !== undefined) {
        const leaf = messages.get(body.activeLeafId, auth.dek);
        if (!leaf || leaf.conversationId !== id || leaf.userId !== auth.userId) {
          throw new AppError('bad_request', 'That message is not part of this conversation.', 400);
        }
        patch.activeLeafId = body.activeLeafId;
      }
      conversations.update(auth.userId, id, patch, clock.now(), auth.dek);
      return requireConversation(auth, id);
    },

    remove: (auth, id) => {
      requireConversation(auth, id);
      conversations.softDelete(auth.userId, id, clock.now());
    },

    restore: (auth, id) => {
      requireConversation(auth, id, true);
      conversations.restore(auth.userId, id, clock.now());
      return requireConversation(auth, id);
    },

    deleteForever: (auth, id) => {
      const found = requireConversation(auth, id, true);
      if (found.deletedAt === null) {
        throw new AppError(
          'bad_request',
          'Only chats in the trash can be deleted forever. Move it to the trash first.',
          400,
        );
      }
      const ids = conversations.purge(auth.userId, null, id);
      if (ids.length > 0) onPurged(ids);
    },

    emptyTrash: (auth) => {
      const ids = conversations.purge(auth.userId, null);
      if (ids.length > 0) onPurged(ids);
      return { purged: ids.length };
    },

    fork: (auth, id, messageId) =>
      forkConversation(
        { db, conversations, messages, clock, attachments: deps.attachments },
        auth,
        id,
        messageId,
      ),

    listFolders: (auth) => folders.list(auth.userId, auth.dek),

    createFolder: (auth, body) => {
      const parentId = body.parentId ?? null;
      if (parentId) {
        requireFolder(auth, parentId);
        if (folders.depth(auth.userId, parentId) + 1 > MAX_FOLDER_DEPTH) throw tooDeep();
      }
      const now = clock.now();
      const folder: Folder = {
        id: newId('fld'),
        parentId,
        name: body.name,
        color: body.color ?? null,
        position: body.position,
        createdAt: now,
        updatedAt: now,
      };
      folders.insert({ ...folder, userId: auth.userId }, auth.dek);
      return folder;
    },

    updateFolder: (auth, id, body) => {
      requireFolder(auth, id);
      if (body.parentId !== undefined && body.parentId !== null) {
        const all = folders.list(auth.userId, auth.dek);
        const parent = all.find((f) => f.id === body.parentId);
        if (!parent) throw folderNotFound();
        if (isDescendant(all, id, parent.id)) {
          throw new AppError('bad_request', 'A folder cannot be moved inside itself.', 400);
        }
        const parentDepth = folders.depth(auth.userId, parent.id);
        if (parentDepth + subtreeHeight(all, id) > MAX_FOLDER_DEPTH) throw tooDeep();
      }
      folders.update(auth.userId, id, body, clock.now(), auth.dek);
      return requireFolder(auth, id);
    },

    removeFolder: (auth, id) => {
      requireFolder(auth, id);
      db.raw.transaction(() => folders.remove(auth.userId, id, clock.now()))();
    },
  };
}
