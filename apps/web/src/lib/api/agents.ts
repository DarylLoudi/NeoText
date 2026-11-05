import {
  type AgentCreate,
  type AgentPublic,
  AgentPublicSchema,
  type AgentUpdate,
} from '@neotext/shared';
import { z } from 'zod';
import {
  type AgentFile,
  AgentFileSchema,
  AgentFilesListSchema,
} from '../../features/agents/knowledge-types';
import { uploadForm } from './attachments';
import { ApiError, apiFetch } from './client';

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
  files: async (id: string): Promise<AgentFile[]> =>
    (await apiFetch(`/agents/${enc(id)}/files`, { schema: AgentFilesListSchema })).files,
  /** Multipart upload with progress (0 to 1). A failed extraction still resolves, as `failed`. */
  uploadFile: async (
    id: string,
    file: File,
    opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
  ): Promise<AgentFile> => {
    const parsed = AgentFileSchema.safeParse(
      await uploadForm(`/api/agents/${enc(id)}/files`, file, opts),
    );
    if (!parsed.success) {
      throw new ApiError('internal', 'The server sent an answer we could not read.', 0);
    }
    return parsed.data;
  },
  removeFile: (id: string, fileId: string): Promise<void> =>
    apiFetch(`/agents/${enc(id)}/files/${enc(fileId)}`, { method: 'DELETE' }),
};
