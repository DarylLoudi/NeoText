import { type SearchProviderKind, SearchProviderKindSchema } from '@neotext/shared';
import { braveBackend } from './backends/brave';
import { searxngBackend } from './backends/searxng';
import { tavilyBackend } from './backends/tavily';
import type { SearchBackend } from './types';

const backends: Record<SearchProviderKind, SearchBackend> = {
  searxng: searxngBackend,
  brave: braveBackend,
  tavily: tavilyBackend,
};

export function getSearchBackend(kind: SearchProviderKind): SearchBackend {
  return backends[kind];
}

export function isSearchKind(kind: string): kind is SearchProviderKind {
  return SearchProviderKindSchema.safeParse(kind).success;
}
