import type { ChatRequestBody, MessagePublic } from '@neotext/shared';
import type { AttachmentsService } from '../attachments/service';
import type { AuthContext } from '../http/env';
import type { StartedTurn } from './chat-service';
import type { Generation } from './generation/generation';
import type { GenerationManager } from './generation/manager';
import type { MessagesRepo } from './messages-repo';

export interface TurnPrepareDeps {
  messages: MessagesRepo;
  generations: Pick<GenerationManager, 'lookupIdempotency' | 'get'>;
  attachments: Pick<AttachmentsService, 'prepareReuse' | 'loadForTurn' | 'discard'>;
}

/** The generations of an earlier request with the same key, if they are still known. */
export function reuse(deps: TurnPrepareDeps, auth: AuthContext, key: string): StartedTurn | null {
  const ids = deps.generations.lookupIdempotency(auth.userId, key);
  const gens = (ids ?? [])
    .map((id) => deps.generations.get(id))
    .filter((g): g is Generation => g !== undefined && g.userId === auth.userId);
  const first = gens[0];
  if (!first) return null;
  const assistant = first.snapshot();
  const parent = assistant.parentId ? deps.messages.get(assistant.parentId, auth.dek) : null;
  let userMessage: MessagePublic | null = null;
  if (parent?.role === 'user' && parent.createdAt === assistant.createdAt) {
    const { userId: _userId, ...rest } = parent;
    userMessage = rest;
  }
  return {
    conversationId: first.conversationId,
    generations: gens,
    userMessage,
    contextTrimmed: 0,
    reused: true,
  };
}

/**
 * The turn's files, with async I/O only: an edit's already-sent uploads are copied, then the
 * new uploads and every file on the path are opened for the model (within the budget).
 */
export async function prepareFiles(
  deps: TurnPrepareDeps,
  auth: AuthContext,
  body: ChatRequestBody,
) {
  const sent = body.userMessage?.attachmentIds ?? [];
  const {
    ids: uploadIds,
    copied,
    unavailable,
  } = await deps.attachments.prepareReuse(auth, sent, body.conversationId);
  try {
    const messageIds =
      body.conversationId !== null && body.parentId !== null
        ? deps.messages.pathIds(body.conversationId, body.parentId)
        : [];
    const loaded = await deps.attachments.loadForTurn(auth, { uploadIds, messageIds });
    return { uploadIds, copied, unavailable, loaded };
  } catch (err) {
    deps.attachments.discard(auth, copied);
    throw err;
  }
}
