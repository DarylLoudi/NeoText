import type dns from 'node:dns';
import {
  type CreateProviderBody,
  type ModelInfo,
  type ModelsResponse,
  newId,
  type ProviderPublic,
  type ProviderTestResult,
  type UpdateProviderBody,
} from '@neotext/shared';
import type { AppConfig } from '../config/env';
import type { Container } from '../container';
import { aad } from '../crypto/aad';
import { openJson, openText, sealJson, sealText } from '../crypto/aead';
import type { DbHandle } from '../db/client';
import type { AuthContext } from '../http/env';
import { AppError } from '../http/errors';
import type { Clock } from '../lib/clock';
import type { Logger } from '../lib/logger';
import { BRAVE_BASE_URL, TAVILY_BASE_URL } from '../search/backends/urls';
import { getSearchBackend, isSearchKind } from '../search/registry';
import { testSearchProvider } from '../search/test-connection';
import { checkEndpointUrl } from './endpoint-url';
import { createModelCache } from './model-cache';
import { OPENROUTER_BASE_URL } from './openrouter/adapter';
import { endpointPolicy, keyHint } from './policy';
import { getAdapter } from './registry';
import { createProvidersRepo, type ProviderRow } from './repo';
import type { ResolvedProvider } from './types';

const WARM_INTERVAL_MS = 60_000;
const TEST_TIMEOUT_MS = 10_000;

export interface ProviderService {
  list(auth: AuthContext): ProviderPublic[];
  create(auth: AuthContext, body: CreateProviderBody): Promise<ProviderPublic>;
  update(auth: AuthContext, id: string, body: UpdateProviderBody): Promise<ProviderPublic>;
  remove(auth: AuthContext, id: string): void;
  resolve(auth: AuthContext, id: string): ResolvedProvider;
  /** Like `resolve`, but a provider that is turned off is a 400. */
  resolveEnabled(auth: AuthContext, id: string): ResolvedProvider;
  /** True when the provider exists for this user and is a search backend, not an LLM provider. */
  isSearchBackend(auth: AuthContext, id: string): boolean;
  /** True when the provider exists for this user and is turned on. */
  isEnabled(auth: AuthContext, id: string): boolean;
  /** True when the provider exists for this user and is shared (no owner). */
  isShared(auth: AuthContext, id: string): boolean;
  test(auth: AuthContext, id: string): Promise<ProviderTestResult>;
  warm(auth: AuthContext, id: string): void;
  models(
    auth: AuthContext,
    id: string,
    opts?: { refresh?: boolean },
  ): Promise<{ models: ModelInfo[]; stale: boolean; error: string | null }>;
  cachedModel(providerId: string, modelId: string): ModelInfo | null;
  allModels(auth: AuthContext): Promise<ModelsResponse>;
  createFromEnv(auth: AuthContext): Promise<ProviderPublic | null>;
  /** Resolves when background model refreshes and connection warms have settled; for tests. */
  flushBackground(): Promise<void>;
}

export interface ProviderServiceDeps {
  db: DbHandle;
  clock: Clock;
  log: Logger;
  config: AppConfig;
  instanceKey: Buffer;
  http: Container['http'];
  /** Test seam for the host check done when an endpoint is saved. */
  lookup?: typeof dns.lookup;
  /** Test seam: how long a connection test may take; 10 s by default. */
  testTimeoutMs?: number;
}

const DEFAULT_BASE_URLS: Partial<Record<CreateProviderBody['kind'], string>> = {
  openrouter: OPENROUTER_BASE_URL,
  brave: BRAVE_BASE_URL,
  tavily: TAVILY_BASE_URL,
};

const notFound = () => new AppError('not_found', 'That provider does not exist.', 404);
const turnedOff = () =>
  new AppError(
    'bad_request',
    'That provider is turned off. Turn it on in Settings → Providers.',
    400,
  );

export function createProviderService(deps: ProviderServiceDeps): ProviderService {
  const { clock, log, config, instanceKey, http, lookup } = deps;
  const repo = createProvidersRepo(deps.db);
  const cache = createModelCache({ repo, clock, log });
  const lastWarm = new Map<string, number>();
  const warming = new Set<Promise<void>>();

  const sealKey = (row: { ownerUserId: string | null }, auth: AuthContext) =>
    row.ownerUserId === null ? instanceKey : auth.dek;

  /** Own rows, plus shared rows for everyone; anything else looks like it does not exist. */
  const seenBy = (auth: AuthContext, row: ProviderRow) =>
    row.ownerUserId === null || row.ownerUserId === auth.userId;
  const visible = (auth: AuthContext, id: string): ProviderRow => {
    const row = repo.find(id);
    if (!row || !seenBy(auth, row)) throw notFound();
    return row;
  };
  const writable = (auth: AuthContext, id: string): ProviderRow => {
    const row = visible(auth, id);
    if (row.ownerUserId === null && auth.role !== 'admin') {
      throw new AppError('forbidden', 'Only an admin can change a shared provider.', 403);
    }
    return row;
  };

  /** Members use a shared provider but never see its key hint or its address (it may be internal). */
  const hideDetails = (auth: AuthContext, row: ProviderRow) =>
    row.ownerUserId === null && auth.role !== 'admin';

  const toPublic = (auth: AuthContext, row: ProviderRow): ProviderPublic => ({
    id: row.id,
    category: row.category,
    kind: row.kind,
    name: row.name,
    baseUrl: hideDetails(auth, row) ? '' : row.baseUrl,
    hasKey: row.apiKey !== null,
    keyHint: row.apiKey !== null && !hideDetails(auth, row) ? row.keyHint : null,
    enabled: row.enabled,
    shared: row.ownerUserId === null,
    manualModels: row.manualModels ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const checkBaseUrl = (auth: AuthContext, baseUrl: string) =>
    checkEndpointUrl(baseUrl, endpointPolicy(auth.role), lookup);

  const resolveRow = (auth: AuthContext, row: ProviderRow): ResolvedProvider => {
    const key = sealKey(row, auth);
    // Shared providers were added by an admin, so they follow the admin's network policy.
    const role = row.ownerUserId === null ? 'admin' : auth.role;
    return {
      id: row.id,
      kind: row.kind,
      baseUrl: row.baseUrl,
      apiKey: row.apiKey ? openText(key, row.apiKey, aad('providers', 'api_key', row.id)) : null,
      headers: row.headers
        ? openJson<Record<string, string>>(key, row.headers, aad('providers', 'headers', row.id))
        : {},
      manualModels: row.manualModels ?? [],
      http: endpointPolicy(role).allowPrivate ? http.endpointsPrivate : http.endpoints,
      appUrl: config.publicUrl,
      ...(hideDetails(auth, row) ? { redactErrors: true } : {}),
    };
  };

  const service: ProviderService = {
    list: (auth) => repo.visibleTo(auth.userId).map((row) => toPublic(auth, row)),

    async create(auth, body) {
      if (body.shared && auth.role !== 'admin') {
        throw new AppError('forbidden', 'Only an admin can share a provider.', 403);
      }
      // A shared provider has no owner; its secrets are sealed with the instance key.
      const key = body.shared ? instanceKey : auth.dek;
      const baseUrl = body.baseUrl ?? DEFAULT_BASE_URLS[body.kind] ?? null;
      if (baseUrl === null) {
        throw new AppError('bad_request', 'Enter the base URL of the endpoint.', 400);
      }
      if (body.baseUrl !== undefined) await checkBaseUrl(auth, body.baseUrl);
      const id = newId('prv');
      const now = clock.now();
      const apiKey = body.apiKey?.trim() || null;
      repo.insert({
        id,
        ownerUserId: body.shared ? null : auth.userId,
        category: isSearchKind(body.kind) ? 'search' : 'llm',
        kind: body.kind,
        name: body.name.trim(),
        baseUrl,
        apiKey: apiKey ? sealText(key, apiKey, aad('providers', 'api_key', id)) : null,
        keyHint: apiKey ? keyHint(apiKey) : null,
        headers: body.headers ? sealJson(key, body.headers, aad('providers', 'headers', id)) : null,
        manualModels: body.manualModels ?? null,
        enabled: true,
        position: id,
        createdAt: now,
        updatedAt: now,
      });
      return toPublic(auth, visible(auth, id));
    },

    async update(auth, id, body) {
      const row = writable(auth, id);
      const key = sealKey(row, auth);
      if (body.baseUrl !== undefined) await checkBaseUrl(auth, body.baseUrl);
      const patch: Parameters<typeof repo.update>[1] = { updatedAt: clock.now() };
      if (body.name !== undefined) patch.name = body.name.trim();
      if (body.baseUrl !== undefined) patch.baseUrl = body.baseUrl;
      if (body.enabled !== undefined) patch.enabled = body.enabled;
      if (body.manualModels !== undefined) patch.manualModels = body.manualModels;
      if (body.apiKey !== undefined) {
        const apiKey = body.apiKey?.trim() || null;
        patch.apiKey = apiKey ? sealText(key, apiKey, aad('providers', 'api_key', id)) : null;
        patch.keyHint = apiKey ? keyHint(apiKey) : null;
      }
      if (body.headers !== undefined) {
        patch.headers = sealJson(key, body.headers, aad('providers', 'headers', id));
      }
      repo.update(id, patch);
      if (body.baseUrl !== undefined || body.apiKey !== undefined || body.headers !== undefined) {
        cache.invalidate(id);
      }
      return toPublic(auth, visible(auth, id));
    },

    remove(auth, id) {
      writable(auth, id);
      repo.remove(id);
      lastWarm.delete(id);
    },

    resolve: (auth, id) => resolveRow(auth, visible(auth, id)),

    resolveEnabled(auth, id) {
      const row = visible(auth, id);
      if (!row.enabled) throw turnedOff();
      return resolveRow(auth, row);
    },

    isSearchBackend(auth, id) {
      const row = repo.find(id);
      return row !== null && seenBy(auth, row) && isSearchKind(row.kind);
    },

    isEnabled(auth, id) {
      const row = repo.find(id);
      return row?.enabled === true && seenBy(auth, row);
    },

    isShared(auth, id) {
      const row = repo.find(id);
      return row !== null && seenBy(auth, row) && row.ownerUserId === null;
    },

    test(auth, id) {
      const p = resolveRow(auth, writable(auth, id));
      if (isSearchKind(p.kind)) {
        return testSearchProvider(
          getSearchBackend(p.kind),
          p,
          AbortSignal.timeout(deps.testTimeoutMs ?? TEST_TIMEOUT_MS),
        );
      }
      return getAdapter(p.kind).test(p, AbortSignal.timeout(deps.testTimeoutMs ?? TEST_TIMEOUT_MS));
    },

    warm(auth, id) {
      try {
        const now = clock.now();
        const last = lastWarm.get(id);
        if (last !== undefined && now - last < WARM_INTERVAL_MS) return;
        const p = service.resolve(auth, id);
        if (isSearchKind(p.kind)) return;
        lastWarm.set(id, now);
        const job: Promise<void> = getAdapter(p.kind)
          .warm(p)
          .catch(() => {})
          .finally(() => warming.delete(job));
        warming.add(job);
      } catch {
        // Warming is best effort.
      }
    },

    models(auth, id, opts) {
      const p = service.resolve(auth, id);
      // Search providers have no models.
      if (isSearchKind(p.kind)) return Promise.resolve({ models: [], stale: false, error: null });
      return cache.load(p, opts);
    },

    cachedModel: (providerId, modelId) => cache.cachedModel(providerId, modelId),

    async allModels(auth) {
      const rows = repo.visibleTo(auth.userId).filter((r) => r.enabled && r.category === 'llm');
      const providers = await Promise.all(
        rows.map(async (row) => {
          const head = { providerId: row.id, providerName: row.name };
          try {
            return { ...head, ...(await cache.load(resolveRow(auth, row))) };
          } catch (err) {
            log.warn(
              { providerId: row.id, err: err instanceof Error ? err.name : 'unknown' },
              'could not list models',
            );
            return {
              ...head,
              models: [],
              stale: false,
              error: 'Could not open this provider. Re-enter its key in Settings → Providers.',
            };
          }
        }),
      );
      return { providers };
    },

    async createFromEnv(auth) {
      if (!config.openrouterApiKey) return null;
      return service.create(auth, {
        kind: 'openrouter',
        name: 'OpenRouter',
        apiKey: config.openrouterApiKey,
      });
    },

    flushBackground: async () => {
      await cache.flushBackground();
      while (warming.size > 0) await Promise.allSettled([...warming]);
    },
  };
  return service;
}
