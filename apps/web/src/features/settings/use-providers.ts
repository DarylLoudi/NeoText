import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { providersApi } from '../../lib/api/providers';
import { qk } from '../../lib/query';

export const providersQuery = queryOptions({
  queryKey: qk.providers,
  queryFn: providersApi.list,
});

export const presetsQuery = queryOptions({
  queryKey: qk.providerPresets,
  queryFn: providersApi.presets,
  staleTime: Number.POSITIVE_INFINITY,
});

/**
 * Create, update and delete. Each one refreshes the provider list, the model catalog and the
 * tools (a search provider can make web search available), so the composer shows the change
 * straight away.
 */
export function useProviderMutations() {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.providers }),
      queryClient.invalidateQueries({ queryKey: qk.models }),
      queryClient.invalidateQueries({ queryKey: qk.tools }),
    ]);
  return {
    create: useMutation({ mutationFn: providersApi.create, onSuccess: refresh }),
    update: useMutation({
      mutationFn: (v: { id: string; body: Parameters<typeof providersApi.update>[1] }) =>
        providersApi.update(v.id, v.body),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: providersApi.remove, onSuccess: refresh }),
    test: useMutation({ mutationFn: providersApi.test }),
  };
}
