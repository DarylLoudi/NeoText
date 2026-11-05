import { type ImportFailure, type ImportResult, newId } from '@neotext/shared';
import type { ConversationsRepo } from '../chat/conversations-repo';
import type { MessagesRepo } from '../chat/messages-repo';
import type { DbHandle } from '../db/client';
import type { AuthContext } from '../http/env';
import type { Logger } from '../lib/logger';
import type { Plan } from './import-plan';
import { type Failure, failure } from './parsers/types';

export interface ImportWriteDeps {
  db: DbHandle;
  conversations: ConversationsRepo;
  messages: MessagesRepo;
  log: Logger;
}

/** A failure as the API sends it: `code` only when there is one. */
export const toFailure = ({ title, code, reason }: ImportFailure): ImportFailure =>
  code === undefined ? { title, reason } : { title, code, reason };

/** Lets other requests run between conversations of a long import. */
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Writes one conversation in its own transaction; returns false when the user has it already. */
function write(deps: ImportWriteDeps, auth: AuthContext, plan: Plan): boolean {
  const { db, conversations, messages } = deps;
  return db.raw.transaction(() => {
    if (conversations.hasImport(auth.userId, plan.importRef, plan.originalId)) return false;
    const id = newId('cnv');
    conversations.insertImported(
      { ...plan.conversation, id, userId: auth.userId, importRef: plan.importRef },
      auth.dek,
    );
    const ids = new Map<string, string>();
    for (const m of plan.messages) {
      const parentId = m.parentSourceId === null ? null : ids.get(m.parentSourceId);
      if (parentId === undefined) throw new Error('message parent was not written first');
      // New ids are monotonic, so tied siblings keep the order they are written in.
      const msgId = newId('msg');
      ids.set(m.sourceId, msgId);
      messages.insert(
        {
          id: msgId,
          conversationId: id,
          userId: auth.userId,
          parentId,
          role: m.role,
          status: m.status,
          parts: m.parts,
          providerId: m.model?.providerId ?? null,
          modelId: m.modelId,
          createdAt: m.createdAt,
        },
        auth.dek,
      );
      if (m.usage !== null || m.finishReason !== null || m.updatedAt !== m.createdAt) {
        messages.update(
          msgId,
          { usage: m.usage, finishReason: m.finishReason },
          m.updatedAt,
          auth.dek,
        );
      }
    }
    const last = plan.messages.at(-1);
    const leaf =
      (plan.activeLeafSourceId !== null ? ids.get(plan.activeLeafSourceId) : undefined) ??
      newestLeaf(plan, ids) ??
      (last ? ids.get(last.sourceId) : undefined) ??
      null;
    conversations.update(
      auth.userId,
      id,
      { activeLeafId: leaf, messageCount: plan.messages.length },
      plan.conversation.updatedAt,
      auth.dek,
    );
    return true;
  })();
}

function newestLeaf(plan: Plan, ids: Map<string, string>): string | undefined {
  const parents = new Set(plan.messages.map((m) => m.parentSourceId));
  let best: Plan['messages'][number] | undefined;
  for (const m of plan.messages) {
    if (!parents.has(m.sourceId) && (!best || m.createdAt >= best.createdAt)) best = m;
  }
  return best ? ids.get(best.sourceId) : undefined;
}

export async function writeAll(
  deps: ImportWriteDeps,
  auth: AuthContext,
  items: ({ ok: true; plan: Plan } | Failure)[],
  result: ImportResult,
): Promise<void> {
  for (const item of items) {
    if (!item.ok) {
      result.failed.push(toFailure(item));
      continue;
    }
    try {
      if (write(deps, auth, item.plan)) {
        result.imported++;
        const notes = item.plan.attachmentNotes ?? 0;
        if (notes > 0) result.attachmentNotes = (result.attachmentNotes ?? 0) + notes;
      } else result.skipped++;
    } catch (err) {
      deps.log.warn({ err: (err as Error).message }, 'an imported conversation could not be saved');
      result.failed.push(
        toFailure(
          failure(
            item.plan.conversation.title,
            'save_failed',
            'This conversation could not be saved.',
          ),
        ),
      );
    }
    await yieldToEventLoop();
  }
}
