import type { ModelInfo, ProviderTestResult } from '@neotext/shared';
import { errorFromException, errorFromResponse } from '../errors';
import { joinUrl, providerHeaders, toRequestBody } from '../openai-compatible/request';
import { streamChatCompletions } from '../openai-compatible/stream';
import type { ChatRequest, ProviderAdapter, ResolvedProvider } from '../types';
import { mapOpenRouterModel } from './models';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

function openRouterHeaders(p: ResolvedProvider): Record<string, string> {
  return {
    ...providerHeaders(p),
    'http-referer': p.appUrl,
    'x-openrouter-title': 'NeoText',
  };
}

async function listModels(p: ResolvedProvider, signal?: AbortSignal): Promise<ModelInfo[]> {
  try {
    const res = await p.http.fetch(joinUrl(p.baseUrl, '/models'), {
      headers: openRouterHeaders(p),
      signal,
    });
    if (!res.ok) throw await errorFromResponse(res);
    const json = (await res.json()) as { data?: unknown };
    const data = Array.isArray(json.data) ? json.data : [];
    return data
      .flatMap((raw) => {
        const model = mapOpenRouterModel(raw, p.id);
        return model ? [model] : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    throw errorFromException(e, signal);
  }
}

export function createOpenRouterAdapter(): ProviderAdapter {
  return {
    kind: 'openrouter',
    listModels,
    streamChat(p: ResolvedProvider, req: ChatRequest, signal: AbortSignal) {
      return streamChatCompletions(p, toRequestBody(req, 'openrouter'), signal, {
        headers: openRouterHeaders(p),
        splitThinkTags: false,
      });
    },
    async test(p, signal): Promise<ProviderTestResult> {
      const started = performance.now();
      try {
        const res = await p.http.fetch(joinUrl(p.baseUrl, '/key'), {
          headers: openRouterHeaders(p),
          signal,
        });
        if (!res.ok) throw await errorFromResponse(res);
        await res.body?.cancel();
        return { ok: true, latencyMs: Math.round(performance.now() - started), modelCount: null };
      } catch (e) {
        const err = errorFromException(e, signal);
        return { ok: false, code: err.code, message: err.message };
      }
    },
    async warm(p) {
      try {
        const res = await p.http.fetch(joinUrl(p.baseUrl, '/key'), {
          headers: openRouterHeaders(p),
          signal: AbortSignal.timeout(3000),
        });
        await res.body?.cancel();
      } catch {
        // Warming is best effort.
      }
    },
  };
}
