import { type SearchResponse, SearchResponseSchema } from '@neotext/shared';
import { apiFetch } from './client';

export const searchApi = {
  /** One page of matches; pass the previous page's `nextCursor` to continue. */
  search: (q: string, cursor?: string | null, signal?: AbortSignal): Promise<SearchResponse> => {
    const params = new URLSearchParams({ q });
    if (cursor) params.set('cursor', cursor);
    return apiFetch(`/search?${params.toString()}`, { schema: SearchResponseSchema, signal });
  },
};
