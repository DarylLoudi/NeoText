import { z } from 'zod';
import { ModelRefSchema } from './model-ref';
import { ReasoningEffortSchema } from './providers';
import { TimeZoneSchema } from './time-zone';

export const SourceSchema = z.object({
  n: z.number().int().min(1),
  url: z.string(),
  title: z.string().max(300),
  domain: z.string(),
  snippet: z.string().max(400),
});
export type Source = z.infer<typeof SourceSchema>;

export const SubagentRunSchema = z.object({
  id: z.string(),
  title: z.string().max(120),
  agentName: z.string().max(60).nullable(),
  status: z.enum(['running', 'ok', 'error', 'stopped']),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  report: z.string().max(4_000).nullable(),
  costUsd: z.number().nullable(),
  /** The sub-agent's tool calls: the tool and a short detail (the query or the URL). */
  toolCalls: z
    .array(z.object({ name: z.string().max(64), detail: z.string().max(200) }))
    .max(20)
    .optional(),
});
export type SubagentRun = z.infer<typeof SubagentRunSchema>;

export const ToolCallPartSchema = z.object({
  type: z.literal('tool_call'),
  id: z.string(),
  name: z.string(),
  source: z.enum(['app', 'mcp', 'provider']),
  args: z.string(),
  status: z.enum(['running', 'awaiting_approval', 'ok', 'error', 'denied', 'no_answer']),
  result: z.string().nullable(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  agents: z.array(SubagentRunSchema).max(6).optional(),
});
export type ToolCallPart = z.infer<typeof ToolCallPartSchema>;

export const MessagePartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('reasoning'),
    text: z.string(),
    durationMs: z.number().nullable(),
  }),
  ToolCallPartSchema,
  z.object({ type: z.literal('sources'), sources: z.array(SourceSchema) }),
  z.object({
    type: z.literal('attachment'),
    attachmentId: z.string(),
    name: z.string(),
    mime: z.string(),
    size: z.number(),
  }),
  z.object({ type: z.literal('agent'), agentId: z.string(), name: z.string().max(60) }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type MessagePart = z.infer<typeof MessagePartSchema>;

export const MessageStatusSchema = z.enum([
  'complete',
  'streaming',
  'error',
  'aborted',
  'interrupted',
]);
export type MessageStatus = z.infer<typeof MessageStatusSchema>;

export const FinishReasonSchema = z.enum([
  'stop',
  'length',
  'tool_calls',
  'content_filter',
  'error',
  'unknown',
]);
export type FinishReason = z.infer<typeof FinishReasonSchema>;

export const UsageSchema = z.object({
  promptTokens: z.number(),
  completionTokens: z.number(),
  reasoningTokens: z.number(),
  cachedTokens: z.number(),
  costUsd: z.number().nullable(),
  webSearchRequests: z.number(),
  ttftMs: z.number().nullable(),
  durationMs: z.number().nullable(),
  upstreamProvider: z.string().nullable(),
  /** Prompt plus completion tokens of the answer's last model call: what the context holds. */
  contextTokens: z.number().nullable().default(null),
});
export type Usage = z.infer<typeof UsageSchema>;

export const MessagePublicSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  parentId: z.string().nullable(),
  role: z.enum(['user', 'assistant']),
  status: MessageStatusSchema,
  parts: z.array(MessagePartSchema),
  model: ModelRefSchema.nullable(),
  usage: UsageSchema.nullable(),
  finishReason: FinishReasonSchema.nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type MessagePublic = z.infer<typeof MessagePublicSchema>;

export const ConversationSummarySchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  titleSource: z.enum(['none', 'auto', 'user']),
  folderId: z.string().nullable(),
  pinned: z.boolean(),
  pinPosition: z.string().nullable(),
  archived: z.boolean(),
  presetId: z.string().nullable(),
  modelRef: ModelRefSchema.nullable(),
  activeLeafId: z.string().nullable(),
  messageCount: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastActivityAt: z.number(),
  deletedAt: z.number().nullable(),
});
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

export const ConversationDetailSchema = z.object({
  conversation: ConversationSummarySchema,
  messages: z.array(MessagePublicSchema),
});
export type ConversationDetail = z.infer<typeof ConversationDetailSchema>;

export const ListConversationsResponseSchema = z.object({
  items: z.array(ConversationSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ListConversationsResponse = z.infer<typeof ListConversationsResponseSchema>;

export const ConversationScopeSchema = z.enum([
  'recent',
  'pinned',
  'archived',
  'folder',
  'all',
  'trash',
]);
export type ConversationScope = z.infer<typeof ConversationScopeSchema>;

const queryBoolean = z.preprocess((v) => {
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return v;
}, z.boolean());

export const ListQuerySchema = z.object({
  scope: ConversationScopeSchema.default('recent'),
  folderId: z.string().optional(),
  includeFoldered: queryBoolean.optional(),
  modelId: z.string().optional(),
  updatedSince: z.coerce.number().optional(),
  titleContains: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
export type ListQuery = z.infer<typeof ListQuerySchema>;

export const UpdateConversationBodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  folderId: z.string().nullable().optional(),
  pinned: z.boolean().optional(),
  pinPosition: z.string().max(64).nullable().optional(),
  archived: z.boolean().optional(),
  activeLeafId: z.string().optional(),
});
export type UpdateConversationBody = z.infer<typeof UpdateConversationBodySchema>;

export const FolderSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  color: z.string().nullable(),
  position: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Folder = z.infer<typeof FolderSchema>;

export const CreateFolderBodySchema = z.object({
  name: z.string().min(1).max(80),
  parentId: z.string().nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  position: z.string().min(1).max(64),
});
export type CreateFolderBody = z.infer<typeof CreateFolderBodySchema>;

export const UpdateFolderBodySchema = CreateFolderBodySchema.partial();
export type UpdateFolderBody = z.infer<typeof UpdateFolderBodySchema>;

export const ChatRequestBodySchema = z.object({
  conversationId: z.string().nullable(),
  parentId: z.string().nullable(),
  userMessage: z
    .object({
      // Empty only when files carry the message.
      text: z.string().max(200_000),
      attachmentIds: z.array(z.string()).max(10).default([]),
    })
    .refine((m) => m.text.length > 0 || m.attachmentIds.length > 0, {
      message: 'Write a message or attach a file.',
      path: ['text'],
    })
    .nullable(),
  targets: z.array(ModelRefSchema).min(1).max(4),
  options: z
    .object({
      webSearch: z.boolean().default(false),
      reasoningEffort: ReasoningEffortSchema.nullable().default(null),
      temperature: z.number().min(0).max(2).nullable().default(null),
      maxOutputTokens: z.number().int().min(1).max(200_000).nullable().default(null),
      presetId: z.string().nullable().default(null),
      agentId: z.string().nullable().default(null),
      folderId: z.string().nullable().default(null),
      timeZone: TimeZoneSchema.default('UTC'),
    })
    .prefault({}),
});
export type ChatRequestBody = z.infer<typeof ChatRequestBodySchema>;

export const ActiveGenerationsResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      conversationId: z.string(),
      assistantMessageId: z.string(),
      model: ModelRefSchema,
      startedAt: z.number(),
    }),
  ),
});
export type ActiveGenerationsResponse = z.infer<typeof ActiveGenerationsResponseSchema>;
