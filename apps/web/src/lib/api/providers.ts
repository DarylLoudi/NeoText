import {
  type CreateProviderBody,
  type ModelInfo,
  ModelInfoSchema,
  type ModelsResponse,
  ModelsResponseSchema,
  type ProviderPreset,
  ProviderPresetSchema,
  type ProviderPublic,
  ProviderPublicSchema,
  type ProviderTestResult,
  ProviderTestResultSchema,
  type UpdateProviderBody,
} from '@neotext/shared';
import { z } from 'zod';
import { apiFetch } from './client';

export interface ProviderModels {
  models: ModelInfo[];
  stale: boolean;
  error: string | null;
}

const ProviderModelsSchema = z.object({
  models: z.array(ModelInfoSchema),
  stale: z.boolean(),
  error: z.string().nullable(),
});

const enc = encodeURIComponent;

export const providersApi = {
  /** Unwraps `{ presets }`. */
  presets: async (): Promise<ProviderPreset[]> =>
    (
      await apiFetch('/provider-presets', {
        schema: z.object({ presets: z.array(ProviderPresetSchema) }),
      })
    ).presets,
  /** Unwraps `{ providers }`. */
  list: async (): Promise<ProviderPublic[]> =>
    (
      await apiFetch('/providers', {
        schema: z.object({ providers: z.array(ProviderPublicSchema) }),
      })
    ).providers,
  /** Unwraps `{ provider }`. */
  create: async (body: CreateProviderBody): Promise<ProviderPublic> =>
    (
      await apiFetch('/providers', {
        method: 'POST',
        body,
        schema: z.object({ provider: ProviderPublicSchema }),
      })
    ).provider,
  /** Unwraps `{ provider }`. */
  update: async (id: string, body: UpdateProviderBody): Promise<ProviderPublic> =>
    (
      await apiFetch(`/providers/${enc(id)}`, {
        method: 'PATCH',
        body,
        schema: z.object({ provider: ProviderPublicSchema }),
      })
    ).provider,
  remove: (id: string): Promise<void> => apiFetch(`/providers/${enc(id)}`, { method: 'DELETE' }),
  test: (id: string): Promise<ProviderTestResult> =>
    apiFetch(`/providers/${enc(id)}/test`, { method: 'POST', schema: ProviderTestResultSchema }),
  warm: (id: string): Promise<void> => apiFetch(`/providers/${enc(id)}/warm`, { method: 'POST' }),
  models: (id: string, refresh?: boolean): Promise<ProviderModels> =>
    apiFetch(`/providers/${enc(id)}/models${refresh ? '?refresh=1' : ''}`, {
      schema: ProviderModelsSchema,
    }),
  allModels: (): Promise<ModelsResponse> => apiFetch('/models', { schema: ModelsResponseSchema }),
};
