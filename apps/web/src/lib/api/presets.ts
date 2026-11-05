import {
  type CreatePresetBody,
  type Preset,
  PresetSchema,
  type UpdatePresetBody,
} from '@neotext/shared';
import { z } from 'zod';
import { apiFetch } from './client';

const enc = encodeURIComponent;

export const presetsApi = {
  /** Unwraps `{ presets }`. */
  list: async (): Promise<Preset[]> =>
    (await apiFetch('/presets', { schema: z.object({ presets: z.array(PresetSchema) }) })).presets,
  create: (body: CreatePresetBody): Promise<Preset> =>
    apiFetch('/presets', { method: 'POST', body, schema: PresetSchema }),
  update: (id: string, body: UpdatePresetBody): Promise<Preset> =>
    apiFetch(`/presets/${enc(id)}`, { method: 'PATCH', body, schema: PresetSchema }),
  remove: (id: string): Promise<void> => apiFetch(`/presets/${enc(id)}`, { method: 'DELETE' }),
};
