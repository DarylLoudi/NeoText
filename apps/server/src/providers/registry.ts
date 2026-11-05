import type { ProviderKind, SearchProviderKind } from '@neotext/shared';
import { createOpenAICompatibleAdapter } from './openai-compatible/adapter';
import { createOpenRouterAdapter } from './openrouter/adapter';
import type { ProviderAdapter } from './types';

type LlmProviderKind = Exclude<ProviderKind, SearchProviderKind>;

const adapters: Record<LlmProviderKind, ProviderAdapter> = {
  openrouter: createOpenRouterAdapter(),
  'openai-compatible': createOpenAICompatibleAdapter(),
};

/** LLM providers only; search kinds go through `getSearchBackend`. */
export function getAdapter(kind: ProviderKind): ProviderAdapter {
  const adapter = adapters[kind as LlmProviderKind];
  if (!adapter) throw new Error(`No chat adapter for provider kind "${kind}".`);
  return adapter;
}
