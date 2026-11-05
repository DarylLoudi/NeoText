import {
  type CreateMcpServerBody,
  type McpServerPublic,
  McpServerPublicSchema,
  type McpTestResult,
  McpTestResultSchema,
  type UpdateMcpServerBody,
} from '@neotext/shared';
import { z } from 'zod';
import { apiFetch } from './client';

const enc = encodeURIComponent;

export const mcpApi = {
  /** Unwraps `{ servers }`. */
  list: async (): Promise<McpServerPublic[]> =>
    (
      await apiFetch('/mcp-servers', {
        schema: z.object({ servers: z.array(McpServerPublicSchema) }),
      })
    ).servers,
  /** Unwraps `{ server }`. */
  create: async (body: CreateMcpServerBody): Promise<McpServerPublic> =>
    (
      await apiFetch('/mcp-servers', {
        method: 'POST',
        body,
        schema: z.object({ server: McpServerPublicSchema }),
      })
    ).server,
  /** Unwraps `{ server }`. */
  update: async (id: string, body: UpdateMcpServerBody): Promise<McpServerPublic> =>
    (
      await apiFetch(`/mcp-servers/${enc(id)}`, {
        method: 'PATCH',
        body,
        schema: z.object({ server: McpServerPublicSchema }),
      })
    ).server,
  remove: (id: string): Promise<void> => apiFetch(`/mcp-servers/${enc(id)}`, { method: 'DELETE' }),
  test: (id: string): Promise<McpTestResult> =>
    apiFetch(`/mcp-servers/${enc(id)}/test`, { method: 'POST', schema: McpTestResultSchema }),
};
