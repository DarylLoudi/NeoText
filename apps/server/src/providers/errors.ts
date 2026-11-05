import { BlockedUrlError } from '../net/ssrf';

export const PROVIDER_ERROR_CODES = [
  'auth',
  'insufficient_credits',
  'rate_limit',
  'model_not_found',
  'context_length',
  'bad_request',
  'moderation',
  'upstream',
  'timeout',
  'network',
  'aborted',
  'bad_response',
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

export class ProviderError extends Error {
  code: ProviderErrorCode;
  status: number | null;
  retryable: boolean;
  retryAfterMs: number | null;

  constructor(
    code: ProviderErrorCode,
    message: string,
    opts: { status?: number | null; retryable?: boolean; retryAfterMs?: number | null } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = opts.status ?? null;
    this.retryable = opts.retryable ?? false;
    this.retryAfterMs = opts.retryAfterMs ?? null;
  }
}

/** What a member sees for each error of a shared provider; the admin sees the real text. */
const SHARED_PROVIDER_MESSAGES: Record<ProviderErrorCode, string> = {
  auth: 'The shared provider turned the request down. Ask your admin to check it.',
  insufficient_credits: 'The shared provider is out of credits. Ask your admin to top it up.',
  rate_limit: 'The shared provider is busy. Wait a moment and try again.',
  model_not_found: 'The shared provider does not offer this model. Pick another model.',
  context_length: 'This chat is too long for the model. Start a new chat or pick another model.',
  bad_request:
    'The shared provider could not handle this request. Try again or pick another model.',
  moderation: "The shared provider refused this request under its provider's content policy.",
  upstream: 'The shared provider had a problem. Try again in a moment.',
  timeout: 'The shared provider took too long to answer. Try again.',
  network: 'Could not reach the shared provider. Try again, or ask your admin to check it.',
  aborted: 'The request was cancelled.',
  bad_response: 'The shared provider sent an answer that could not be read. Ask your admin.',
};

/** Longest upstream error text kept in a log line. */
const LOGGED_MESSAGE_MAX = 500;

/**
 * The text a user is shown for `err` from provider `p`: the real message, or for a member on a
 * shared provider the fixed one, with the real message logged under the ids in `logFields`.
 */
export function shownProviderMessage(
  p: { id: string; redactErrors?: boolean },
  err: ProviderError,
  log: { warn(obj: object, msg: string): void },
  logFields: Record<string, unknown> = {},
): string {
  if (!p.redactErrors) return err.message;
  log.warn(
    {
      ...logFields,
      providerId: p.id,
      code: err.code,
      status: err.status,
      upstreamMessage: err.message.slice(0, LOGGED_MESSAGE_MAX),
    },
    'shared provider error, shown to the member as a fixed text',
  );
  return SHARED_PROVIDER_MESSAGES[err.code];
}

export const NOT_A_STREAM =
  'The endpoint did not return a chat stream. Check the base URL — it usually ends in /v1.';

export const TIMEOUT_MESSAGE =
  'The endpoint took too long to answer. Check the base URL and try again.';

/** `hasError` is true when the body is JSON carrying an `error` object. */
function parseErrorBody(text: string): { hasError: boolean; message: string | null } {
  try {
    const parsed: unknown = JSON.parse(text);
    const err = (parsed as { error?: unknown } | null)?.error;
    if (typeof err !== 'object' || err === null) return { hasError: false, message: null };
    const msg = (err as { message?: unknown }).message;
    return { hasError: true, message: typeof msg === 'string' && msg !== '' ? msg : null };
  } catch {
    return { hasError: false, message: null };
  }
}

/** Maps a non-2xx response to a ProviderError. Consumes the body; never echoes a raw body. */
export async function errorFromResponse(res: Response): Promise<ProviderError> {
  const status = res.status;
  const text = await res.text().catch(() => '');
  const body = parseErrorBody(text);
  // A 404/405 page that is not an API error means the request never reached a chat API.
  if ((status === 404 || status === 405) && !body.hasError) {
    return new ProviderError('bad_response', NOT_A_STREAM, { status });
  }
  const message = body.message ?? `The endpoint returned HTTP ${status}.`;
  if (status === 401 || status === 403) return new ProviderError('auth', message, { status });
  if (status === 402) return new ProviderError('insufficient_credits', message, { status });
  if (status === 404) return new ProviderError('model_not_found', message, { status });
  if (status === 408 || status === 504) return new ProviderError('timeout', message, { status });
  if (status === 413 || (status === 400 && /context/i.test(message))) {
    return new ProviderError('context_length', message, { status });
  }
  if (status === 429) {
    const header = res.headers.get('retry-after')?.trim();
    const seconds = header ? Number(header) : Number.NaN;
    const retryAfterMs =
      Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
    return new ProviderError('rate_limit', message, { status, retryable: true, retryAfterMs });
  }
  if (status >= 500) return new ProviderError('upstream', message, { status, retryable: true });
  return new ProviderError('bad_request', message, { status });
}

/** Maps the top-level `error` object of a streamed chunk. */
export function errorFromChunk(err: { code?: unknown; message?: unknown }): ProviderError {
  const message =
    typeof err.message === 'string' && err.message !== ''
      ? err.message
      : 'The provider reported an error.';
  const code = typeof err.code === 'string' && /^\d+$/.test(err.code) ? Number(err.code) : err.code;
  if (code === 'rate_limit_exceeded' || code === 429) {
    return new ProviderError('rate_limit', message, { retryable: true });
  }
  if (code === 'server_error' || (typeof code === 'number' && code >= 500)) {
    return new ProviderError('upstream', message, { retryable: true });
  }
  return new ProviderError('bad_request', message);
}

function findInCauseChain(e: unknown): BlockedUrlError | null {
  let cur: unknown = e;
  for (let i = 0; i < 10 && cur; i++) {
    if (cur instanceof BlockedUrlError) return cur;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

/** Maps a thrown value from fetch/stream code. undici wraps connect-time refusals in `cause`. */
export function errorFromException(e: unknown, signal?: AbortSignal): ProviderError {
  if (e instanceof ProviderError) return e;
  if (signal?.aborted) {
    const reason: unknown = signal.reason;
    if (reason instanceof DOMException && reason.name === 'TimeoutError') {
      return new ProviderError('timeout', TIMEOUT_MESSAGE);
    }
    return new ProviderError('aborted', 'The request was cancelled.');
  }
  if (findInCauseChain(e)) {
    return new ProviderError('bad_request', 'This address is not allowed for this endpoint.');
  }
  return new ProviderError(
    'network',
    'Could not reach the endpoint. Check the base URL and your network connection.',
  );
}
