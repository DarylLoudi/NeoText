import {
  type ActiveGenerationsResponse,
  ActiveGenerationsResponseSchema,
  type ApprovalBody,
  type ChatRequestBody,
} from '@neotext/shared';
import { apiFetch, rawFetch } from './client';

export type ActiveGeneration = ActiveGenerationsResponse['items'][number];

export const chatApi = {
  /** Returns the raw SSE response; non-2xx throws ApiError before streaming. */
  start: (body: ChatRequestBody, idempotencyKey: string, signal?: AbortSignal): Promise<Response> =>
    rawFetch('/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    }),
  /** Returns the raw SSE response; it begins with a `generation.snapshot`. */
  resume: (generationId: string, signal?: AbortSignal): Promise<Response> =>
    rawFetch(`/generations/${encodeURIComponent(generationId)}/stream`, {
      headers: { Accept: 'text/event-stream' },
      ...(signal ? { signal } : {}),
    }),
  abort: (generationId: string): Promise<void> =>
    apiFetch(`/generations/${encodeURIComponent(generationId)}/abort`, { method: 'POST' }),
  /** Answers a tool call that waits for approval; the stream then moves the call on. */
  approve: (generationId: string, body: ApprovalBody): Promise<void> =>
    apiFetch(`/generations/${encodeURIComponent(generationId)}/approvals`, {
      method: 'POST',
      body,
    }),
  /** Unwraps `{ items }`. */
  active: async (): Promise<ActiveGeneration[]> =>
    (await apiFetch('/generations/active', { schema: ActiveGenerationsResponseSchema })).items,
};
