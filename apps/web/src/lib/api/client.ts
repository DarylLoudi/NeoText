import type { ErrorCode } from '@neotext/shared';
import { ApiErrorBodySchema } from '@neotext/shared';
import type { z } from 'zod';

export class ApiError extends Error {
  code: ErrorCode | 'network';
  status: number;
  details?: unknown;
  requestId?: string;

  constructor(
    code: ErrorCode | 'network',
    message: string,
    status: number,
    details?: unknown,
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

export interface ApiOptions<T> {
  method?: string;
  body?: unknown;
  schema?: z.ZodType<T>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

const BASE = '/api';
const UNAUTHORIZED_EXEMPT = new Set(['/auth/me', '/auth/login']);

let onUnauthorized: () => void = () => {};

export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

async function toApiError(res: Response): Promise<ApiError> {
  let parsed: ReturnType<typeof ApiErrorBodySchema.safeParse> | undefined;
  try {
    parsed = ApiErrorBodySchema.safeParse(await res.json());
  } catch {
    parsed = undefined;
  }
  if (parsed?.success) {
    const { code, message, details, requestId } = parsed.data.error;
    return new ApiError(code, message, res.status, details, requestId);
  }
  return new ApiError('internal', `The server returned an error (${res.status}).`, res.status);
}

/** Sends a request to the page's own origin; throws ApiError for network failures and non-2xx. */
export async function rawFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { credentials: 'same-origin', ...init });
  } catch (cause) {
    if (init.signal?.aborted) throw cause;
    throw new ApiError('network', 'Could not reach the server. Check your connection.', 0);
  }
  if (!res.ok) {
    const err = await toApiError(res);
    // A wrong password typed into a signed-in form is a refusal, not an ended session.
    const sessionEnded = res.status === 401 && err.code !== 'invalid_credentials';
    if (sessionEnded && !UNAUTHORIZED_EXEMPT.has(path.split('?')[0] ?? path)) {
      onUnauthorized();
    }
    throw err;
  }
  return res;
}

export async function apiFetch<T>(path: string, opts: ApiOptions<T> = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  const init: RequestInit = { method: opts.method ?? 'GET', headers };
  if (opts.signal) init.signal = opts.signal;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await rawFetch(path, init);
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json();
  if (import.meta.env.DEV && opts.schema) return opts.schema.parse(json);
  return json as T;
}
