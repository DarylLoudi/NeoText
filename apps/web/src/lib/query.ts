import type { ListQuery, UsageSummaryQuery } from '@neotext/shared';
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api/client';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) =>
          error instanceof ApiError && error.code === 'network' && failureCount < 2,
      },
    },
  });
}

export const queryClient = createQueryClient();

export const qk = {
  session: ['session'] as const,
  instance: ['instance'] as const,
  conversations: (query: Partial<ListQuery> = {}) => ['conversations', query] as const,
  conversation: (id: string) => ['conversation', id] as const,
  folders: ['folders'] as const,
  presets: ['presets'] as const,
  providers: ['providers'] as const,
  models: ['models'] as const,
  providerPresets: ['provider-presets'] as const,
  mcpServers: ['mcp-servers'] as const,
  settingsHistory: ['settings', 'history'] as const,
  active: ['generations', 'active'] as const,
  tools: ['tools'] as const,
  /** Under `tools`, so invalidating the tools list refreshes it too. */
  toolsMeta: ['tools', 'meta'] as const,
  usageSummary: (q: UsageSummaryQuery) => ['usage', 'summary', q] as const,
  /** Under `usage`, so invalidating usage refreshes the budget too. */
  budget: ['usage', 'budget'] as const,
  sessions: ['sessions'] as const,
  adminAudit: (userId: string | null) => ['admin', 'audit', userId] as const,
  /** Under `usage`, like the budget. */
  quota: ['usage', 'quota'] as const,
  adminUsers: ['admin', 'users'] as const,
  adminInvites: ['admin', 'invites'] as const,
  adminInstance: ['admin', 'instance'] as const,
  adminQuota: (userId: string) => ['admin', 'quota', userId] as const,
};
