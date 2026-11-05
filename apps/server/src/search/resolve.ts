import type { AuthContext } from '../http/env';
import type { ProviderService } from '../providers/service';
import type { ResolvedProvider } from '../providers/types';
import { getSearchBackend, isSearchKind } from './registry';
import type { SearchBackend } from './types';

export interface ResolvedBackend {
  backend: SearchBackend;
  provider: ResolvedProvider;
}

/** The chosen search backend with its provider, or null when none is chosen, on, or usable. */
export function resolveSearchBackend(
  auth: AuthContext,
  providers: Pick<ProviderService, 'isEnabled' | 'resolve'>,
  providerId: string | null,
): ResolvedBackend | null {
  if (!providerId) return null;
  try {
    if (!providers.isEnabled(auth, providerId)) return null;
    const provider = providers.resolve(auth, providerId);
    if (!isSearchKind(provider.kind)) return null;
    return { backend: getSearchBackend(provider.kind), provider };
  } catch {
    return null;
  }
}
