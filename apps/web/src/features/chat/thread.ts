import { childrenOf, type MessagePublic, newestLeafUnder, pathToLeaf } from '@neotext/shared';
import { sameTurnAnswers } from '../compare/compare-group';

/** One turn on the visible path, with its place among the versions of that turn. */
export interface ThreadItem {
  message: MessagePublic;
  siblingIndex: number;
  siblingCount: number;
  siblingIds: string[];
  /**
   * The answers written side by side with this one, while none has been chosen: the list
   * draws them as columns in place of this message. Only ever on the last turn.
   */
  compare?: MessagePublic[];
  /** Answered side by side and settled: the columns can be shown again. */
  comparable?: boolean;
}

/** The leaf a chat shows when its saved leaf is missing: the newest one under the newest root. */
function fallbackLeaf(messages: MessagePublic[]): string | null {
  const root = childrenOf(messages, null).at(-1);
  return root ? newestLeafUnder(messages, root.id).id : null;
}

/**
 * The leaf a chat shows and continues from: the saved one when it is in the tree, else the
 * newest. A chat whose leaf was never saved still has a visible branch to continue.
 */
export function visibleLeaf(messages: MessagePublic[], activeLeafId: string | null): string | null {
  if (activeLeafId !== null && messages.some((m) => m.id === activeLeafId)) return activeLeafId;
  return fallbackLeaf(messages);
}

/**
 * The root-to-leaf path the chat shows. `live` overlays messages still being written, so a
 * streaming answer is drawn from the generations store instead of the cached copy. When the
 * last user message was answered by several models at once, its answer carries the group
 * (`compare`) until `chosen` says an answer was picked for it.
 */
export function buildThread(
  messages: MessagePublic[],
  activeLeafId: string | null,
  live: (id: string) => MessagePublic | undefined,
  chosen: (userMessageId: string) => boolean = () => false,
): ThreadItem[] {
  const leaf = visibleLeaf(messages, activeLeafId);
  const path = leaf === null ? [] : pathToLeaf(messages, leaf);
  // One pass over the tree, not one per turn: this runs on every streamed frame.
  const onPath = new Set(path.map((m) => m.parentId));
  const groups = new Map<string | null, MessagePublic[]>();
  for (const m of messages) {
    if (!onPath.has(m.parentId)) continue;
    const list = groups.get(m.parentId);
    if (list) list.push(m);
    else groups.set(m.parentId, [m]);
  }
  const lastUser = path.findLast((m) => m.role === 'user');
  return path.map((m) => {
    const siblings = groups.get(m.parentId) ?? [m];
    const siblingIds = childrenOf(siblings, m.parentId).map((n) => n.id);
    const item: ThreadItem = {
      message: live(m.id) ?? m,
      siblingIndex: siblingIds.indexOf(m.id),
      siblingCount: siblingIds.length,
      siblingIds,
    };
    const group =
      lastUser && m.parentId === lastUser.id && siblingIds.length > 1
        ? sameTurnAnswers(siblings, m)
        : null;
    if (group && lastUser) {
      if (chosen(lastUser.id)) item.comparable = true;
      else item.compare = group.map((n) => live(n.id) ?? n);
    }
    return item;
  });
}

/** The active leaf after switching to another version of a turn: its newest descendant. */
export function switchBranch(messages: MessagePublic[], siblingId: string): string {
  return newestLeafUnder(messages, siblingId).id;
}

/** "deepseek/deepseek-v4.1-flash" becomes "deepseek v4.1 flash". */
export function shortModelName(modelId: string): string {
  const last = modelId.split('/').at(-1) || modelId;
  return last.replace(/-/g, ' ');
}

/** The plain text of a message (its text parts, joined). */
export function messageText(m: MessagePublic): string {
  return m.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('');
}

/** Whether two thread items draw the same (thread items are rebuilt on every streamed frame). */
export function sameItem(a: ThreadItem, b: ThreadItem): boolean {
  return (
    a.message === b.message &&
    a.siblingIndex === b.siblingIndex &&
    a.siblingCount === b.siblingCount &&
    a.siblingIds.every((id, i) => b.siblingIds[i] === id) &&
    a.comparable === b.comparable &&
    (a.compare?.length ?? 0) === (b.compare?.length ?? 0) &&
    (a.compare ?? []).every((m, i) => b.compare?.[i] === m)
  );
}
