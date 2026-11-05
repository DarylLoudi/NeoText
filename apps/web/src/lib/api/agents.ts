import {
  type AgentCreate,
  type AgentPublic,
  AgentPublicSchema,
  type AgentUpdate,
} from '@neotext/shared';
import { z } from 'zod';
import { apiFetch } from './client';

const enc = encodeURIComponent;

export const agentsApi = {
  /** Unwraps `{ agents }`. */
  list: async (): Promise<AgentPublic[]> =>
    (await apiFetch('/agents', { schema: z.object({ agents: z.array(AgentPublicSchema) }) }))
      .agents,
  create: (body: AgentCreate): Promise<AgentPublic> =>
    apiFetch('/agents', { method: 'POST', body, schema: AgentPublicSchema }),
  update: (id: string, body: AgentUpdate): Promise<void> =>
    apiFetch(`/agents/${enc(id)}`, { method: 'PATCH', body }),
  remove: (id: string): Promise<void> => apiFetch(`/agents/${enc(id)}`, { method: 'DELETE' }),
};
