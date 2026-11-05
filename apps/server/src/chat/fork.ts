import {
  ATTACHMENT_UNAVAILABLE_ID,
  type ConversationSummary,
  type MessagePart,
  newId,
  pathToLeaf,
} from '@neotext/shared';
import type { AttachmentPart, AttachmentsService } from '../attachments/service';
import type { DbHandle } from '../db/client';
import type { AuthContext } from '../http/env';
import { AppError } from '../http/errors';
import type { Clock } from '../lib/clock';
import type { ConversationsRepo } from './conversations-repo';
import type { MessagesRepo } from './messages-repo';

export interface ForkDeps {
  db: DbHandle;
  conversations: ConversationsRepo;
  messages: MessagesRepo;
  clock: Clock;
  /** Copies attached files so the fork owns its own. */
  attachments: Pick<AttachmentsService, 'copyAsUpload' | 'attach' | 'discard'>;
}

/**
 * Copies the path from the root to `messageId` into a new chat. Messages get new ids and are
 * re-sealed under them; unfinished answers become `interrupted` in the copy. Attached files are
 * copied under new ids too, so deleting either chat forever leaves the other's files alone.
 *
 * The file copies happen first, as unsent uploads, with async I/O outside the transaction; the
 * transaction then only links them. If it fails, the copies are discarded (and an unsent upload
 * the discard misses is swept after a day), so the fork stays all or nothing.
 */
export async function forkConversation(
  deps: ForkDeps,
  auth: AuthContext,
  conversationId: string,
  messageId: string,
): Promise<ConversationSummary> {
  const { db, conversations, messages, clock } = deps;
  const original = conversations.get(auth.userId, conversationId, auth.dek);
  if (!original) throw new AppError('not_found', 'That conversation does not exist.', 404);
  const target = messages.get(messageId, auth.dek);
  if (!target || target.conversationId !== conversationId || target.userId !== auth.userId) {
    throw new AppError('bad_request', 'That message is not part of this conversation.', 400);
  }
  const path = pathToLeaf(messages.listForConversation(conversationId, auth.dek), messageId);

  const copyId = newId('cnv');
  /** Source attachment id to its copy; null when the source file is gone. */
  const copies = new Map<string, AttachmentPart | null>();
  const copied = () => [...copies.values()].flatMap((p) => (p ? [p.attachmentId] : []));
  try {
    for (const m of path) {
      for (const p of m.parts) {
        if (p.type !== 'attachment' || copies.has(p.attachmentId)) continue;
        const copy =
          p.attachmentId === ATTACHMENT_UNAVAILABLE_ID
            ? null
            : await deps.attachments.copyAsUpload(auth, p.attachmentId);
        copies.set(p.attachmentId, copy ? { ...p, attachmentId: copy.id } : null);
      }
    }
  } catch (err) {
    deps.attachments.discard(auth, copied());
    throw err;
  }
  /** A missing source becomes an unavailable part rather than a shared id. */
  const copyParts = (parts: MessagePart[]): MessagePart[] =>
    parts.map((p) =>
      p.type === 'attachment'
        ? (copies.get(p.attachmentId) ?? { ...p, attachmentId: ATTACHMENT_UNAVAILABLE_ID })
        : p,
    );
  try {
    db.raw.transaction(() => {
      const now = clock.now();
      conversations.insert(
        {
          id: copyId,
          userId: auth.userId,
          folderId: original.folderId,
          title: `${original.title ?? ''} (copy)`.trim(),
          createdAt: now,
        },
        auth.dek,
      );
      const idMap = new Map<string, string>();
      for (const m of path) {
        const id = newId('msg');
        idMap.set(m.id, id);
        messages.insert(
          {
            id,
            conversationId: copyId,
            userId: auth.userId,
            parentId: m.parentId ? (idMap.get(m.parentId) ?? null) : null,
            role: m.role,
            status: m.status === 'streaming' ? 'interrupted' : m.status,
            parts: copyParts(m.parts),
            providerId: m.model?.providerId ?? null,
            modelId: m.model?.modelId ?? null,
            createdAt: m.createdAt,
          },
          auth.dek,
        );
        const linked = m.parts.flatMap((p) => {
          const copy = p.type === 'attachment' ? copies.get(p.attachmentId) : null;
          return copy ? [copy.attachmentId] : [];
        });
        if (linked.length > 0) deps.attachments.attach(auth, linked, copyId, id);
      }
      conversations.update(
        auth.userId,
        copyId,
        {
          titleSource: 'user',
          modelRef: original.modelRef,
          presetId: original.presetId,
          activeLeafId: idMap.get(messageId) ?? null,
          messageCount: path.length,
        },
        now,
        auth.dek,
      );
    })();
  } catch (err) {
    // The links rolled back with the transaction; the copies themselves did not.
    deps.attachments.discard(auth, copied());
    throw err;
  }

  const copy = conversations.get(auth.userId, copyId, auth.dek);
  if (!copy) throw new AppError('internal', 'The copy could not be created. Try again.', 500);
  return copy;
}
