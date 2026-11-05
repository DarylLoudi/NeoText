import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { mcpApi } from '../../lib/api/mcp';
import { qk } from '../../lib/query';

export const mcpServersQuery = queryOptions({
  queryKey: qk.mcpServers,
  queryFn: mcpApi.list,
});

/** Create, update and delete. Each one refreshes the server list. */
export function useMcpMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.mcpServers });
  return {
    create: useMutation({ mutationFn: mcpApi.create, onSuccess: refresh }),
    update: useMutation({
      mutationFn: (v: { id: string; body: Parameters<typeof mcpApi.update>[1] }) =>
        mcpApi.update(v.id, v.body),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: mcpApi.remove, onSuccess: refresh }),
    test: useMutation({ mutationFn: mcpApi.test }),
  };
}
