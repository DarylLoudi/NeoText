import {
  type SettingsHistoryItem,
  SettingsHistoryResponseSchema,
  type SettingsResponse,
  SettingsResponseSchema,
} from '@neotext/shared';
import { apiFetch } from './client';

export const settingsApi = {
  get: (): Promise<SettingsResponse> => apiFetch('/settings', { schema: SettingsResponseSchema }),
  patch: (patch: Record<string, unknown>, signal?: AbortSignal): Promise<SettingsResponse> =>
    apiFetch('/settings', {
      method: 'PATCH',
      body: { patch },
      schema: SettingsResponseSchema,
      ...(signal ? { signal } : {}),
    }),
  /** Unwraps `{ items }`. */
  history: async (): Promise<SettingsHistoryItem[]> =>
    (await apiFetch('/settings/history', { schema: SettingsHistoryResponseSchema })).items,
  restore: (version: number): Promise<SettingsResponse> =>
    apiFetch('/settings/restore', {
      method: 'POST',
      body: { version },
      schema: SettingsResponseSchema,
    }),
};
