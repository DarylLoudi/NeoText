import { childrenOf, type MessagePublic } from '@neotext/shared';
import type { ThreadItem } from '../chat/thread';

/**
 * The answers among `siblings` written in the same turn as `m`: one send to several models
 * gives every answer the same parent and `createdAt`. Null unless there are at least two.
 */
export function sameTurnAnswers(
  siblings: MessagePublic[],
  m: MessagePublic,
): MessagePublic[] | null {
  if (m.role !== 'assistant') return null;
  const group = childrenOf(
    siblings.filter((s) => s.role === 'assistant' && s.createdAt === m.createdAt),
    m.parentId,
  );
  return group.length >= 2 ? group : null;
}

/** The side-by-side answers `item` belongs to, oldest first, or null when it stands alone. */
export function compareGroupFor(
  messages: MessagePublic[],
  item: ThreadItem,
): MessagePublic[] | null {
  return sameTurnAnswers(messages, item.message);
}
