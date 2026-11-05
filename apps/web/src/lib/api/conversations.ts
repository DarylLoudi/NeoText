import {
  type ConversationDetail,
  ConversationDetailSchema,
  type ConversationSummary,
  ConversationSummarySchema,
  type ListConversationsResponse,
  ListConversationsResponseSchema,
  type ListQuery,
  type UpdateConversationBody,
} from '@neotext/shared';
import { z } from 'zod';
import { apiFetch } from './client';

export interface CreateConversationBody {
  title?: string;
  folderId?: string | null;
}

/** Fields with server defaults (scope, limit) are optional here. */
export type ConversationListQuery = Partial<ListQuery>;

function toSearch(query: ConversationListQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

const enc = encodeURIComponent;

export const conversationsApi = {
  /** Returns the `{ items, nextCursor }` page as-is. */
  list: (query: ConversationListQuery = {}): Promise<ListConversationsResponse> =>
    apiFetch(`/conversations${toSearch(query)}`, { schema: ListConversationsResponseSchema }),
  create: (body: CreateConversationBody = {}): Promise<ConversationSummary> =>
    apiFetch('/conversations', { method: 'POST', body, schema: ConversationSummarySchema }),
  detail: (id: string): Promise<ConversationDetail> =>
    apiFetch(`/conversations/${enc(id)}`, { schema: ConversationDetailSchema }),
  update: (id: string, body: UpdateConversationBody): Promise<ConversationSummary> =>
    apiFetch(`/conversations/${enc(id)}`, {
      method: 'PATCH',
      body,
      schema: ConversationSummarySchema,
    }),
  remove: (id: string): Promise<void> =>
    apiFetch(`/conversations/${enc(id)}`, { method: 'DELETE' }),
  restore: (id: string): Promise<ConversationSummary> =>
    apiFetch(`/conversations/${enc(id)}/restore`, {
      method: 'POST',
      schema: ConversationSummarySchema,
    }),
  /** Only works on a chat that is already in the trash. */
  deleteForever: (id: string): Promise<void> =>
    apiFetch(`/conversations/${enc(id)}?permanent=1`, { method: 'DELETE' }),
  emptyTrash: (): Promise<{ purged: number }> =>
    apiFetch('/trash', { method: 'DELETE', schema: z.object({ purged: z.number() }) }),
  fork: (id: string, messageId: string): Promise<ConversationSummary> =>
    apiFetch(`/conversations/${enc(id)}/fork`, {
      method: 'POST',
      body: { messageId },
      schema: ConversationSummarySchema,
    }),
};
