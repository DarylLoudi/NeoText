import type { ModelInfo } from '@neotext/shared';
import type { Clock } from '../lib/clock';
import type { Logger } from '../lib/logger';
import { ProviderError, shownProviderMessage } from './errors';
import { getAdapter } from './registry';
import type { ProvidersRepo } from './repo';
import type { ResolvedProvider } from './types';

export const MODEL_CACHE_TTL_MS = 6 * 3_600_000;
const FETCH_TIMEOUT_MS = 20_000;

export interface ModelList {
  models: ModelInfo[];
  stale: boolean;
  error: string | null;
}

export interface ModelCache {
  load(p: ResolvedProvider, opts?: { refresh?: boolean }): Promise<ModelList>;
  /** Forgets cached models and keeps any fetch already in flight from storing its result. */
  invalidate(providerId: string): void;
  cachedModel(providerId: string, modelId: string): ModelInfo | null;
  /** Resolves when every background refresh has settled; for tests. */
  flushBackground(): Promise<void>;
}

export function createModelCache(deps: {
  repo: ProvidersRepo;
  clock: Clock;
  log: Logger;
}): ModelCache {
  const { repo, clock, log } = deps;
  const inflight = new Map<string, Promise<ModelInfo[]>>();
  const generation = new Map<string, number>();
  const background = new Set<Promise<void>>();

  /** One fetch per provider at a time; callers that arrive meanwhile share the result. */
  const fetchAndStore = (p: ResolvedProvider): Promise<ModelInfo[]> => {
    const running = inflight.get(p.id);
    if (running) return running;
    const started = generation.get(p.id) ?? 0;
    const job = getAdapter(p.kind)
      .listModels(p, AbortSignal.timeout(FETCH_TIMEOUT_MS))
      .then((models) => {
        if ((generation.get(p.id) ?? 0) === started) {
          repo.writeCache(p.id, { fetchedAt: clock.now(), models });
        }
        return models;
      })
      .finally(() => {
        if (inflight.get(p.id) === job) inflight.delete(p.id);
      });
    inflight.set(p.id, job);
    return job;
  };

  const refreshInBackground = (p: ResolvedProvider) => {
    if (inflight.has(p.id)) return;
    const job: Promise<void> = fetchAndStore(p)
      .then(
        () => undefined,
        (err) => {
          log.warn(
            { providerId: p.id, code: err instanceof ProviderError ? err.code : 'unknown' },
            'model refresh failed',
          );
        },
      )
      .finally(() => background.delete(job));
    background.add(job);
  };

  const describe = (p: ResolvedProvider, err: unknown) =>
    err instanceof ProviderError
      ? shownProviderMessage(p, err, log)
      : 'Could not load the model list. Try again.';

  return {
    async load(p, opts = {}) {
      const cached = repo.readCache(p.id);
      if (cached && !opts.refresh) {
        const stale = clock.now() - cached.fetchedAt > MODEL_CACHE_TTL_MS;
        if (stale) refreshInBackground(p);
        return { models: cached.models, stale, error: null };
      }
      try {
        return { models: await fetchAndStore(p), stale: false, error: null };
      } catch (err) {
        return { models: cached?.models ?? [], stale: cached !== null, error: describe(p, err) };
      }
    },
    invalidate(providerId) {
      generation.set(providerId, (generation.get(providerId) ?? 0) + 1);
      inflight.delete(providerId);
      repo.clearCache(providerId);
    },
    cachedModel(providerId, modelId) {
      return repo.readCache(providerId)?.models.find((m) => m.id === modelId) ?? null;
    },
    async flushBackground() {
      while (background.size > 0) await Promise.allSettled([...background]);
    },
  };
}
