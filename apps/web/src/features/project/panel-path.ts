import { type MessagePublic, pathToLeaf } from '@neotext/shared';
import type { ThreadItem } from '../chat/thread';

/**
 * The branch the open panel shows, and the answer it keeps its place at. The visible branch,
 * unless the panel was opened from a compare column of this turn: then that column's branch.
 * An opener that left the view (regenerated, or another version picked) gives way to the
 * visible branch, following its latest version.
 */
export function panelPathFor(
  items: ThreadItem[],
  messages: MessagePublic[],
  from: string | null,
  live: (id: string) => MessagePublic | undefined,
): { path: MessagePublic[]; messageId: string | null } {
  const visible = items.map((i) => i.message);
  if (from === null) return { path: visible, messageId: null };
  if (visible.some((m) => m.id === from)) return { path: visible, messageId: from };
  const inColumn = items.some((i) => i.compare?.some((m) => m.id === from));
  if (!inColumn || !messages.some((m) => m.id === from)) return { path: visible, messageId: null };
  return { path: pathToLeaf(messages, from).map((m) => live(m.id) ?? m), messageId: from };
}
