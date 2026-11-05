import { z } from 'zod';

export const ProviderKindSchema = z.enum([
  'openrouter',
  'openai-compatible',
  'searxng',
  'brave',
  'tavily',
]);
export const SearchProviderKindSchema = z.enum(['searxng', 'brave', 'tavily']);
export type SearchProviderKind = z.infer<typeof SearchProviderKindSchema>;
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

export const ProviderCategorySchema = z.enum(['llm', 'search']);
export type ProviderCategory = z.infer<typeof ProviderCategorySchema>;

export const ReasoningEffortSchema = z.enum([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

export const ProviderPublicSchema = z.object({
  id: z.string(),
  category: ProviderCategorySchema,
  kind: ProviderKindSchema,
  name: z.string(),
  baseUrl: z.string(),
  hasKey: z.boolean(),
  keyHint: z.string().nullable(),
  enabled: z.boolean(),
  shared: z.boolean(),
  manualModels: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type ProviderPublic = z.infer<typeof ProviderPublicSchema>;

const httpUrl = z.url({ protocol: /^https?$/ });
const headersSchema = z
  .record(z.string(), z.string())
  .refine((h) => Object.keys(h).length <= 10, 'At most 10 headers are allowed.');

export const CreateProviderBodySchema = z
  .object({
    kind: ProviderKindSchema,
    name: z.string().min(1).max(60),
    baseUrl: httpUrl.optional(),
    apiKey: z.string().max(512).optional(),
    headers: headersSchema.optional(),
    manualModels: z.array(z.string()).max(200).optional(),
    /** Admins only: share the provider with every member, keeping its key hidden. */
    shared: z.boolean().optional(),
  })
  .refine(
    (b) => (b.kind !== 'openai-compatible' && b.kind !== 'searxng') || b.baseUrl !== undefined,
    { message: 'baseUrl is required for this kind of provider.', path: ['baseUrl'] },
  )
  .refine((b) => (b.kind !== 'brave' && b.kind !== 'tavily') || (b.apiKey ?? '').trim() !== '', {
    message: 'apiKey is required for this kind of provider.',
    path: ['apiKey'],
  });
export type CreateProviderBody = z.infer<typeof CreateProviderBodySchema>;

export const UpdateProviderBodySchema = z.object({
  name: z.string().min(1).max(60).optional(),
  baseUrl: httpUrl.optional(),
  apiKey: z.string().max(512).nullable().optional(),
  headers: headersSchema.optional(),
  manualModels: z.array(z.string()).max(200).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateProviderBody = z.infer<typeof UpdateProviderBodySchema>;

export const ModelInfoSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  contextLength: z.number().nullable(),
  maxOutputTokens: z.number().nullable(),
  inputModalities: z.array(z.string()),
  outputModalities: z.array(z.string()),
  pricing: z.object({
    promptPerM: z.number().nullable(),
    completionPerM: z.number().nullable(),
    cacheReadPerM: z.number().nullable(),
  }),
  supports: z.object({
    tools: z.boolean().nullable(),
    reasoning: z.boolean().nullable(),
    structuredOutputs: z.boolean().nullable(),
    webSearch: z.boolean(),
  }),
  reasoning: z
    .object({
      mandatory: z.boolean(),
      efforts: z.array(ReasoningEffortSchema),
      defaultEffort: ReasoningEffortSchema.nullable(),
    })
    .nullable(),
  knowledgeCutoff: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.number().nullable(),
});
export type ModelInfo = z.infer<typeof ModelInfoSchema>;

export const ProviderTestResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), latencyMs: z.number(), modelCount: z.number().nullable() }),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
]);
export type ProviderTestResult = z.infer<typeof ProviderTestResultSchema>;

export const ProviderPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: ProviderKindSchema,
  baseUrl: z.string(),
  keyRequired: z.boolean(),
});
export type ProviderPreset = z.infer<typeof ProviderPresetSchema>;

export const ModelsResponseSchema = z.object({
  providers: z.array(
    z.object({
      providerId: z.string(),
      providerName: z.string(),
      models: z.array(ModelInfoSchema),
      stale: z.boolean(),
      error: z.string().nullable(),
    }),
  ),
});
export type ModelsResponse = z.infer<typeof ModelsResponseSchema>;
