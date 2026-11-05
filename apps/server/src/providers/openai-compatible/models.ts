import type { ModelInfo } from '@neotext/shared';
import { errorFromException, errorFromResponse } from '../errors';
import type { ResolvedProvider } from '../types';
import { joinUrl, providerHeaders } from './request';

function toModelInfo(providerId: string, id: string): ModelInfo {
  return {
    id,
    providerId,
    name: id,
    description: null,
    contextLength: null,
    maxOutputTokens: null,
    // `/models` lists ids only: empty means unknown, so attachments are not held back.
    inputModalities: [],
    outputModalities: ['text'],
    pricing: { promptPerM: null, completionPerM: null, cacheReadPerM: null },
    supports: { tools: null, reasoning: null, structuredOutputs: null, webSearch: false },
    reasoning: null,
    knowledgeCutoff: null,
    expiresAt: null,
    createdAt: null,
  };
}

/** `listed` is false when the endpoint has no `/models` route (404). */
export async function fetchModels(
  p: ResolvedProvider,
  signal?: AbortSignal,
): Promise<{ models: ModelInfo[]; listed: boolean }> {
  let ids: string[] = [];
  let listed = true;
  try {
    const res = await p.http.fetch(joinUrl(p.baseUrl, '/models'), {
      headers: providerHeaders(p),
      signal,
    });
    if (res.status === 404) {
      listed = false;
      await res.body?.cancel();
    } else if (!res.ok) {
      throw await errorFromResponse(res);
    } else {
      const json = (await res.json()) as { data?: unknown };
      if (Array.isArray(json.data)) {
        ids = json.data.flatMap((m: unknown) => {
          const id = (m as { id?: unknown } | null)?.id;
          return typeof id === 'string' && id !== '' ? [id] : [];
        });
      }
    }
  } catch (e) {
    throw errorFromException(e, signal);
  }
  const unique = [...new Set([...ids, ...p.manualModels])];
  return { models: unique.map((id) => toModelInfo(p.id, id)), listed };
}

export async function fetchModelList(
  p: ResolvedProvider,
  signal?: AbortSignal,
): Promise<ModelInfo[]> {
  return (await fetchModels(p, signal)).models;
}
