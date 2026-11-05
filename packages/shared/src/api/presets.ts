import { z } from 'zod';
import { ModelRefSchema } from '../model-ref';
import { ReasoningEffortSchema } from '../providers';

export const PresetDataSchema = z.object({
  systemPrompt: z.string().max(20_000),
  model: ModelRefSchema.nullable(),
  reasoningEffort: ReasoningEffortSchema.nullable(),
  temperature: z.number().min(0).max(2).nullable(),
  maxOutputTokens: z.number().int().min(1).max(200_000).nullable(),
  webSearch: z.boolean(),
  /** An accent name from the appearance settings. */
  color: z.string().max(32).nullable(),
});
export type PresetData = z.infer<typeof PresetDataSchema>;

export const PresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  data: PresetDataSchema,
  position: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Preset = z.infer<typeof PresetSchema>;

export const CreatePresetBodySchema = z.object({
  name: z.string().trim().min(1).max(60),
  data: PresetDataSchema,
  position: z.string().min(1).max(64),
});
export type CreatePresetBody = z.infer<typeof CreatePresetBodySchema>;

export const UpdatePresetBodySchema = CreatePresetBodySchema.partial();
export type UpdatePresetBody = z.infer<typeof UpdatePresetBodySchema>;
