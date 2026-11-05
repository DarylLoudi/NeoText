import type { ModelInfo, ModelsResponse } from '@neotext/shared';

/** A catalog entry with sensible defaults; override what the test cares about. */
export function modelInfo(over: Partial<ModelInfo> & { id: string }): ModelInfo {
  return {
    providerId: 'prv_1',
    name: over.id,
    description: null,
    contextLength: 128_000,
    maxOutputTokens: null,
    inputModalities: ['text'],
    outputModalities: ['text'],
    pricing: { promptPerM: 1, completionPerM: 2, cacheReadPerM: null },
    supports: { tools: null, reasoning: null, structuredOutputs: null, webSearch: false },
    reasoning: null,
    knowledgeCutoff: null,
    expiresAt: null,
    createdAt: null,
    ...over,
  };
}

export const deepseek = modelInfo({
  id: 'deepseek/deepseek-v4.1',
  name: 'DeepSeek V4.1',
  contextLength: 1_000_000,
  pricing: { promptPerM: 0.045, completionPerM: 0.5, cacheReadPerM: null },
  inputModalities: ['text', 'image'],
  supports: { tools: true, reasoning: true, structuredOutputs: null, webSearch: false },
  reasoning: { mandatory: false, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
  knowledgeCutoff: '2026-01',
});

export const deepseekFlash = modelInfo({
  id: 'deepseek/deepseek-v4.1-flash',
  name: 'DeepSeek V4.1 Flash',
  contextLength: 256_000,
  pricing: { promptPerM: 0.02, completionPerM: 0.2, cacheReadPerM: null },
});

export const freeModel = modelInfo({
  id: 'acme/free-1',
  name: 'Acme Free',
  pricing: { promptPerM: 0, completionPerM: 0, cacheReadPerM: null },
});

export const catalog: ModelInfo[] = [deepseek, deepseekFlash, freeModel];

export function modelsResponse(
  models: ModelInfo[] = catalog,
  providerName = 'OpenRouter',
): ModelsResponse {
  return {
    providers: models.length
      ? [{ providerId: 'prv_1', providerName, models, stale: false, error: null }]
      : [],
  };
}
