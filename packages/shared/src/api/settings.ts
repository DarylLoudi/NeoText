import { z } from 'zod';
import { UserSettingsSchema } from '../settings/schema';

export const SettingsResponseSchema = z.object({
  version: z.number().int(),
  settings: UserSettingsSchema,
  resetPaths: z.array(z.string()),
  recovered: z.boolean(),
});
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>;

export const PatchSettingsBodySchema = z.object({ patch: z.record(z.string(), z.unknown()) });
export type PatchSettingsBody = z.infer<typeof PatchSettingsBodySchema>;

export const SettingsHistoryItemSchema = z.object({
  version: z.number().int(),
  createdAt: z.number().int(),
  reason: z.enum(['autosave', 'restore', 'migration', 'quarantine']),
});
export type SettingsHistoryItem = z.infer<typeof SettingsHistoryItemSchema>;

export const SettingsHistoryResponseSchema = z.object({
  items: z.array(SettingsHistoryItemSchema),
});
export type SettingsHistoryResponse = z.infer<typeof SettingsHistoryResponseSchema>;

export const RestoreSettingsBodySchema = z.object({ version: z.number().int() });
export type RestoreSettingsBody = z.infer<typeof RestoreSettingsBodySchema>;
