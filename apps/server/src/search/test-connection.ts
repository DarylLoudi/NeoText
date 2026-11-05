import type { ProviderTestResult } from '@neotext/shared';
import { errorFromException, type ProviderErrorCode } from '../providers/errors';
import type { ResolvedProvider } from '../providers/types';
import { type SearchBackend, SearchError } from './types';

function codeFor(status: number | null): ProviderErrorCode {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  return status === null ? 'bad_response' : 'upstream';
}

/** Runs a one-result search for "neotext" and reports it like an LLM connection test. */
export async function testSearchProvider(
  backend: SearchBackend,
  p: ResolvedProvider,
  signal: AbortSignal,
): Promise<ProviderTestResult> {
  const started = performance.now();
  try {
    await backend.search(p, 'neotext', { count: 1, signal });
    return { ok: true, latencyMs: Math.round(performance.now() - started), modelCount: null };
  } catch (e) {
    if (e instanceof SearchError) return { ok: false, code: codeFor(e.status), message: e.message };
    const err = errorFromException(e, signal);
    return { ok: false, code: err.code, message: err.message };
  }
}
