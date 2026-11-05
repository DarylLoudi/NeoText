import type { ProviderTestResult } from '@neotext/shared';
import { errorFromException, NOT_A_STREAM } from '../errors';
import type { ChatRequest, ProviderAdapter, ResolvedProvider } from '../types';
import { fetchModelList, fetchModels } from './models';
import { joinUrl, providerHeaders, toRequestBody } from './request';
import { streamChatCompletions } from './stream';

export function createOpenAICompatibleAdapter(): ProviderAdapter {
  return {
    kind: 'openai-compatible',
    listModels: fetchModelList,
    streamChat(p: ResolvedProvider, req: ChatRequest, signal: AbortSignal) {
      return streamChatCompletions(p, toRequestBody(req, 'openai'), signal, {
        headers: providerHeaders(p),
        splitThinkTags: true,
      });
    },
    async test(p, signal): Promise<ProviderTestResult> {
      const started = performance.now();
      try {
        const { models, listed } = await fetchModels(p, signal);
        // No /models route and nothing to fall back on: the base URL is almost certainly wrong.
        if (!listed && p.manualModels.length === 0) {
          return { ok: false, code: 'bad_response', message: NOT_A_STREAM };
        }
        return {
          ok: true,
          latencyMs: Math.round(performance.now() - started),
          modelCount: listed ? models.length : null,
        };
      } catch (e) {
        const err = errorFromException(e, signal);
        return { ok: false, code: err.code, message: err.message };
      }
    },
    async warm(p) {
      try {
        const res = await p.http.fetch(joinUrl(p.baseUrl, '/models'), {
          headers: providerHeaders(p),
          signal: AbortSignal.timeout(3000),
        });
        await res.body?.cancel();
      } catch {
        // Warming is best effort.
      }
    },
  };
}
