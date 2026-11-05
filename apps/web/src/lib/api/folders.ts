import {
  type CreateFolderBody,
  type Folder,
  FolderSchema,
  type UpdateFolderBody,
} from '@neotext/shared';
import { z } from 'zod';
import { apiFetch } from './client';

const enc = encodeURIComponent;

export const foldersApi = {
  /** Unwraps `{ folders }`. */
  list: async (): Promise<Folder[]> =>
    (await apiFetch('/folders', { schema: z.object({ folders: z.array(FolderSchema) }) })).folders,
  create: (body: CreateFolderBody): Promise<Folder> =>
    apiFetch('/folders', { method: 'POST', body, schema: FolderSchema }),
  update: (id: string, body: UpdateFolderBody): Promise<Folder> =>
    apiFetch(`/folders/${enc(id)}`, { method: 'PATCH', body, schema: FolderSchema }),
  remove: (id: string): Promise<void> => apiFetch(`/folders/${enc(id)}`, { method: 'DELETE' }),
};
