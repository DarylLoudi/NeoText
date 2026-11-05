import type { ModelInfo } from '@neotext/shared';
import { useQuery } from '@tanstack/react-query';
import { toolsApi } from '../../../lib/api/tools';
import { qk } from '../../../lib/query';

/**
 * Whether a message may search the web: the model searches by itself (OpenRouter), or a search
 * backend is set up. There is no toggle; the model decides when to search.
 */
export function useWebSearchAvailable(model: ModelInfo | null): boolean {
  const native = model?.supports.webSearch ?? false;
  const tools = useQuery({
    queryKey: qk.toolsMeta,
    queryFn: toolsApi.meta,
    enabled: model !== null && !native,
    staleTime: 5 * 60_000,
  });
  return native || tools.data?.webSearchBackend === true;
}
