import {
  type ConversationSummary,
  type ModelInfo,
  type ModelRef,
  type ModelsResponse,
  modelKey,
} from '@neotext/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { providersApi } from '../../../lib/api/providers';
import { qk } from '../../../lib/query';
import { useSettings } from '../../../state/settings';
import { resolveModel } from './resolve-model';

export type CatalogProvider = ModelsResponse['providers'][number];

export interface ModelsState {
  /** Every provider that answered, with the models the user has not hidden. */
  providers: CatalogProvider[];
  /** All visible models, provider by provider. */
  models: ModelInfo[];
  byKey: Map<string, ModelInfo>;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export const keyOf = (m: ModelInfo): string =>
  modelKey({ providerId: m.providerId, modelId: m.id });

export function useModels(): ModelsState {
  const query = useQuery({
    queryKey: qk.models,
    queryFn: providersApi.allModels,
    staleTime: 60_000,
  });
  // A string, so a settings change that leaves the list alone does not rebuild the catalog.
  const hiddenKey = useSettings((s) => s.settings.models.hidden.join('\n'));
  const { data, refetch } = query;
  return useMemo(() => {
    const hidden = new Set(hiddenKey ? hiddenKey.split('\n') : []);
    const providers = (data?.providers ?? []).map((p) => ({
      ...p,
      models: p.models.filter((m) => !hidden.has(keyOf(m))),
    }));
    const models = providers.flatMap((p) => p.models);
    return {
      providers,
      models,
      byKey: new Map(models.map((m) => [keyOf(m), m])),
      isLoading: query.isPending,
      isError: query.isError && !data,
      refetch: () => void refetch(),
    };
  }, [data, hiddenKey, query.isPending, query.isError, refetch]);
}

export interface ActiveModel extends ModelsState {
  ref: ModelRef | null;
  model: ModelInfo | null;
}

/** The model the next message in this chat goes to (see `resolveModel`). */
export function useActiveModel(
  conversation: ConversationSummary | null,
  pending: ModelRef | null,
): ActiveModel {
  const catalog = useModels();
  const settings = useSettings((s) => s.settings);
  const ref = useMemo(
    () => resolveModel(conversation, settings, catalog.models, pending),
    [conversation, settings, catalog.models, pending],
  );
  const model = ref ? (catalog.byKey.get(modelKey(ref)) ?? null) : null;
  return useMemo(() => ({ ...catalog, ref, model }), [catalog, ref, model]);
}
