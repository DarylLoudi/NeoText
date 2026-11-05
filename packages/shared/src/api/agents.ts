import { z } from 'zod';
import { ModelRefSchema } from '../model-ref';

export const AgentToolsSchema = z.object({
  webSearch: z.boolean().default(true),
  fetchUrl: z.boolean().default(true),
});
export type AgentTools = z.infer<typeof AgentToolsSchema>;

export const AgentDataSchema = z.object({
  description: z.string().max(500).default(''),
  instructions: z.string().max(50_000),
  model: ModelRefSchema.nullable().default(null),
  tools: AgentToolsSchema.prefault({}),
  autoDelegate: z.boolean().default(false),
  enabled: z.boolean().default(true),
});
export type AgentData = z.infer<typeof AgentDataSchema>;

/** Control characters and line breaks become spaces, so a name is always one line. */
export const AgentNameSchema = z
  .string()
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it strips.
  .transform((s) => s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\s]+/g, ' ').trim())
  .pipe(z.string().min(1).max(60));

export const AgentPublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  data: AgentDataSchema,
  position: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type AgentPublic = z.infer<typeof AgentPublicSchema>;

export const AgentCreateSchema = z.object({ name: AgentNameSchema, data: AgentDataSchema });
export type AgentCreate = z.infer<typeof AgentCreateSchema>;

export const AgentUpdateSchema = z.object({
  name: AgentNameSchema.optional(),
  data: AgentDataSchema.optional(),
  position: z.string().max(32).optional(),
});
export type AgentUpdate = z.infer<typeof AgentUpdateSchema>;

export const AgentsListSchema = z.object({ agents: z.array(AgentPublicSchema) });
export type AgentsList = z.infer<typeof AgentsListSchema>;

/** Most bytes one knowledge file upload may have. */
export const AGENT_FILE_MAX_BYTES = 10 * 1024 * 1024;
/** Most knowledge files one agent may hold. */
export const AGENT_FILES_MAX = 20;

/** A file in an agent's knowledge base: only its extracted text is kept, in sealed chunks. */
export const AgentFileSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  name: z.string(),
  size: z.number(),
  pages: z.number().nullable(),
  chunks: z.number(),
  status: z.enum(['ready', 'failed']),
  error: z.string().nullable(),
  createdAt: z.number(),
});
export type AgentFile = z.infer<typeof AgentFileSchema>;

export const AgentFilesListSchema = z.object({ files: z.array(AgentFileSchema) });
export type AgentFilesList = z.infer<typeof AgentFilesListSchema>;
