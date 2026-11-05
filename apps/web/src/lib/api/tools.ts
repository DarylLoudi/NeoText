import { type ToolsResponse, ToolsResponseSchema } from '@neotext/shared';
import { apiFetch } from './client';

export const toolsApi = {
  list: (): Promise<ToolsResponse> => apiFetch('/tools', { schema: ToolsResponseSchema }),
  /** Only `webSearchBackend` (the tool list is empty), so no tool server is contacted. */
  meta: (): Promise<ToolsResponse> => apiFetch('/tools?only=meta', { schema: ToolsResponseSchema }),
};
