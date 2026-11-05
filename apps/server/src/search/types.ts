import type { SearchProviderKind } from '@neotext/shared';
import type { ResolvedProvider } from '../providers/types';

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

/** `status` is the HTTP status, or null when the answer was not usable at all. */
export class SearchError extends Error {
  status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'SearchError';
    this.status = status;
  }
}

export interface SearchBackend {
  kind: SearchProviderKind;
  search(
    p: ResolvedProvider,
    query: string,
    opts: { count: number; signal: AbortSignal },
  ): Promise<SearchResult[]>;
}
