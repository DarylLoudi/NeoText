import type { ChatRequestBody, MessagePublic, Preset } from '@neotext/shared';
import { and, eq } from 'drizzle-orm';
import type { DbHandle } from '../db/client';
import { folders } from '../db/schema';
import type { AuthContext } from '../http/env';
import { AppError } from '../http/errors';
import type { PresetsService } from '../presets/service';
import type { ConversationsRepo } from './conversations-repo';
import type { MessagesRepo } from './messages-repo';

export interface TurnHistoryDeps {
  db: DbHandle;
  conversations: ConversationsRepo;
  presets: Pick<PresetsService, 'get' | 'find'>;
  messages: MessagesRepo;
}

const notInConversation = () =>
  new AppError('bad_request', 'That message is not part of this conversation.', 400);

function requireFolder(db: DbHandle, userId: string, folderId: string) {
  const found = db.orm
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.userId, userId)))
    .get();
  if (!found) throw new AppError('not_found', 'That folder does not exist.', 404);
}

/** Messages of the target conversation; `[]` for a new one. 404 when missing or deleted. */
export function loadHistory(
  deps: TurnHistoryDeps,
  auth: AuthContext,
  body: ChatRequestBody,
): MessagePublic[] {
  if (body.conversationId === null) {
    if (body.options.folderId !== null) requireFolder(deps.db, auth.userId, body.options.folderId);
    return [];
  }
  if (!deps.conversations.get(auth.userId, body.conversationId, auth.dek)) {
    throw new AppError('not_found', 'That conversation does not exist.', 404);
  }
  return deps.messages.listForConversation(body.conversationId, auth.dek);
}

/**
 * The preset a turn runs under: the one the request names (404 unless it is the user's), else
 * the one the chat was started with. A chat outlives a deleted preset, which then just stops
 * applying.
 */
export function resolvePreset(
  deps: TurnHistoryDeps,
  auth: AuthContext,
  body: ChatRequestBody,
): Preset | null {
  if (body.options.presetId !== null) return deps.presets.get(auth, body.options.presetId);
  if (body.conversationId === null) return null;
  const id = deps.conversations.get(auth.userId, body.conversationId, auth.dek)?.presetId;
  return id ? deps.presets.find(auth, id) : null;
}

export function checkParent(body: ChatRequestBody, history: MessagePublic[]) {
  const parent = body.parentId === null ? null : history.find((m) => m.id === body.parentId);
  if (body.parentId !== null && !parent) throw notInConversation();
  if (body.userMessage === null) {
    if (parent?.role !== 'user') {
      throw new AppError('bad_request', 'Regenerate needs the user message it answers.', 400);
    }
  } else if (parent && parent.role !== 'assistant') {
    throw new AppError(
      'bad_request',
      'A new message follows an answer. Pick an assistant message as its parent.',
      400,
    );
  }
}
