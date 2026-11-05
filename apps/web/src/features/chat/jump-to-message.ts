import type { ConversationDetail } from '@neotext/shared';
import { pathToLeaf } from '@neotext/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { conversationsApi } from '../../lib/api/conversations';
import { qk } from '../../lib/query';
import { toast } from '../../ui';
import { errorMessage, upsertConversation } from '../sidebar/use-conversations';
import { switchBranch, visibleLeaf } from './thread';

/**
 * Brings a message found by search onto the visible path. When it sits on another branch, the
 * chat's active leaf moves to the newest leaf under it (shown at once, then saved), the same
 * move the branch switcher makes. Runs once per message id.
 */
export function useJumpToMessage(
  conversationId: string | null,
  messageId: string | undefined,
  detail: ConversationDetail | undefined,
): void {
  const qc = useQueryClient();
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId || !messageId || !detail || done.current === messageId) return;
    const { messages, conversation } = detail;
    // Cached data from before the message existed may not hold it yet; wait for fresh data.
    if (!messages.some((m) => m.id === messageId)) return;
    done.current = messageId;
    const leaf = visibleLeaf(messages, conversation.activeLeafId);
    if (pathToLeaf(messages, leaf).some((m) => m.id === messageId)) return;

    const key = qk.conversation(conversationId);
    const activeLeafId = switchBranch(messages, messageId);
    const before = conversation.activeLeafId;
    const withLeaf = (next: string | null) =>
      qc.setQueryData<ConversationDetail>(key, (d) =>
        d ? { ...d, conversation: { ...d.conversation, activeLeafId: next } } : d,
      );
    withLeaf(activeLeafId);
    conversationsApi.update(conversationId, { activeLeafId }).then(
      (saved) => upsertConversation(qc, saved),
      (err) => {
        withLeaf(before);
        toast({ message: errorMessage(err), tone: 'danger' });
      },
    );
  }, [conversationId, messageId, detail, qc]);
}
