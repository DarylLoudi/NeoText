import { z } from 'zod';
import { ToolPolicySchema } from '../settings/schema';

/** Longest tool call id the approval endpoint takes; the server maps longer upstream ids. */
export const CALL_ID_MAX = 200;

export const ApprovalBodySchema = z.object({
  callId: z.string().min(1).max(CALL_ID_MAX),
  decision: z.enum(['allow', 'deny']),
  remember: z.boolean().default(false),
});
export type ApprovalBody = z.infer<typeof ApprovalBodySchema>;

export const ToolInfoSchema = z.object({
  name: z.string(),
  description: z.string(),
  source: z.enum(['app', 'mcp']),
  policy: ToolPolicySchema,
  defaultPolicy: ToolPolicySchema,
  /** For an MCP tool: the server's name and the tool's own name, as the server reports them. */
  mcp: z.object({ server: z.string(), tool: z.string() }).optional(),
});
export type ToolInfo = z.infer<typeof ToolInfoSchema>;

export const ToolsResponseSchema = z.object({
  tools: z.array(ToolInfoSchema),
  webSearchBackend: z.boolean(),
});
export type ToolsResponse = z.infer<typeof ToolsResponseSchema>;
