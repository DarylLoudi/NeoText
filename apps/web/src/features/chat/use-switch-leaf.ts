import type { ConversationDetail } from '@neotext/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { conversationsApi } from '../../lib/api/conversations';
import { qk } from '../../lib/query';
import { toast } from '../../ui';
import { errorMessage, upsertConversation } from '../sidebar/use-conversations';
import { switchBranch } from './thread';

/**
 * Moves a chat to another version of a turn, and to that version's newest leaf: shown at once,
 * saved after. A failed save puts the old leaf back and says so. Resolves whether it was saved.
 */
export function useSwitchLeaf(conversationId: string) {
  const qc = useQueryClient();
  return useCallback(
    async (versionId: string): Promise<boolean> => {
      const key = qk.conversation(conversationId);
      const detail = qc.getQueryData<ConversationDetail>(key);
      if (!detail) return false;
      const activeLeafId = switchBranch(detail.messages, versionId);
      const before = detail.conversation.activeLeafId;
      const withLeaf = (leaf: string | null) =>
        qc.setQueryData<ConversationDetail>(key, (d) =>
          d ? { ...d, conversation: { ...d.conversation, activeLeafId: leaf } } : d,
        );
      withLeaf(activeLeafId);
      // A later switch made while this one was in flight wins.
      const stillCurrent = () =>
        qc.getQueryData<ConversationDetail>(key)?.conversation.activeLeafId === activeLeafId;
      try {
        const saved = await conversationsApi.update(conversationId, { activeLeafId });
        if (stillCurrent()) upsertConversation(qc, saved);
        return true;
      } catch (err) {
        if (stillCurrent()) withLeaf(before);
        toast({ message: errorMessage(err), tone: 'danger' });
        return false;
      }
    },
    [qc, conversationId],
  );
}
