import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { qk } from '../../lib/query';
import { onServerSettings } from '../../state/settings';

/**
 * Whether web search is available depends on the search backend saved on the server. So the
 * tools list is read again whenever that changes there, even if the save only went through on
 * a retry long after it was made, or came from another tab.
 */
export function useToolsFollowSettings(): void {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      onServerSettings((next, previous) => {
        if (!previous) return;
        const before = previous.settings.webSearch.backendProviderId;
        if (next.settings.webSearch.backendProviderId === before) return;
        void queryClient.invalidateQueries({ queryKey: qk.tools });
      }),
    [queryClient],
  );
}
