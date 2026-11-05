import { z } from 'zod';
import { MessagePublicSchema, SourceSchema, ToolCallPartSchema, UsageSchema } from './chat';

const base = { generationId: z.string(), seq: z.number() };

export const StreamEventSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('generation.started'),
    conversationId: z.string(),
    userMessage: MessagePublicSchema.nullable(),
    assistantMessage: MessagePublicSchema,
    contextTrimmed: z.number(),
  }),
  z.object({ ...base, type: z.literal('generation.snapshot'), message: MessagePublicSchema }),
  z.object({ ...base, type: z.literal('text.delta'), text: z.string() }),
  z.object({ ...base, type: z.literal('reasoning.delta'), text: z.string() }),
  z.object({ ...base, type: z.literal('reasoning.done'), durationMs: z.number() }),
  z.object({ ...base, type: z.literal('tool.started'), call: ToolCallPartSchema }),
  z.object({ ...base, type: z.literal('tool.updated'), call: ToolCallPartSchema }),
  z.object({ ...base, type: z.literal('sources.added'), sources: z.array(SourceSchema) }),
  z.object({
    ...base,
    type: z.literal('activity'),
    kind: z.enum(['searching', 'processing', 'idle']),
  }),
  z.object({ ...base, type: z.literal('usage'), usage: UsageSchema }),
  z.object({ ...base, type: z.literal('generation.finished'), message: MessagePublicSchema }),
  z.object({
    ...base,
    type: z.literal('conversation.updated'),
    conversationId: z.string(),
    title: z.string().nullable(),
  }),
  z.object({ ...base, type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type StreamEvent = z.infer<typeof StreamEventSchema>;

export type StreamEventPayload = StreamEvent extends infer E
  ? E extends StreamEvent
    ? Omit<E, 'generationId' | 'seq'>
    : never
  : never;

export function formatSSEData(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}
