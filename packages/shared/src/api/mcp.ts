import { z } from 'zod';

export const McpServerPublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  /** Header values are secrets: only whether any are set is ever returned. */
  hasHeaders: z.boolean(),
  enabled: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type McpServerPublic = z.infer<typeof McpServerPublicSchema>;

const mcpName = z.string().trim().min(1).max(40);
const httpUrl = z.url({ protocol: /^https?$/ });
/** RFC 9110 token characters; values may not break the header line. */
const headerName = z.string().regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/, 'Invalid header name.');
const headerValue = z
  .string()
  .max(4096)
  .regex(/^[^\r\n\0]*$/, 'Invalid header value.');
const mcpHeaders = z
  .record(headerName, headerValue)
  .refine((h) => Object.keys(h).length <= 10, 'At most 10 headers are allowed.');

export const CreateMcpServerBodySchema = z.object({
  name: mcpName,
  url: httpUrl,
  headers: mcpHeaders.optional(),
});
export type CreateMcpServerBody = z.infer<typeof CreateMcpServerBodySchema>;

export const UpdateMcpServerBodySchema = z.object({
  name: mcpName.optional(),
  url: httpUrl.optional(),
  /** `null` removes all headers. */
  headers: mcpHeaders.nullable().optional(),
  enabled: z.boolean().optional(),
});
export type UpdateMcpServerBody = z.infer<typeof UpdateMcpServerBodySchema>;

export const McpTestResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    tools: z.array(z.object({ name: z.string(), description: z.string() })),
  }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);
export type McpTestResult = z.infer<typeof McpTestResultSchema>;
