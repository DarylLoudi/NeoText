import { parseSSE } from '@neotext/shared';
import { errorFromException, errorFromResponse, NOT_A_STREAM, ProviderError } from '../errors';
import type { ProviderEvent, ResolvedProvider } from '../types';
import { createChunkMapper } from './chunk-mapper';
import { joinUrl } from './request';

const MAX_BAD_LINES = 5;

const aborted = () => new ProviderError('aborted', 'The request was cancelled.');

/** Maps a complete (non-streaming) chat completion into a one-shot chunk. */
function completionToChunk(json: Record<string, unknown>): unknown {
  const choice = (json.choices as Record<string, unknown>[])[0] ?? {};
  const message = choice.message as Record<string, unknown>;
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls.map((t, index) => ({ index, ...(t as object) }))
    : undefined;
  return {
    ...json,
    choices: [{ ...choice, delta: { ...message, tool_calls: toolCalls } }],
  };
}

function isCompletion(json: unknown): json is Record<string, unknown> {
  const choices = (json as { choices?: unknown } | null)?.choices;
  return (
    Array.isArray(choices) &&
    typeof choices[0] === 'object' &&
    choices[0] !== null &&
    typeof (choices[0] as { message?: unknown }).message === 'object'
  );
}

/**
 * POSTs to `<baseUrl>/chat/completions` and yields normalized events.
 * The upstream request is aborted whenever this generator ends (early return, error, idle
 * timeout or caller abort) so the connection is always released.
 */
export async function* streamChatCompletions(
  p: ResolvedProvider,
  body: Record<string, unknown>,
  signal: AbortSignal,
  opts: { headers: Record<string, string>; splitThinkTags: boolean; idleTimeoutMs?: number },
): AsyncGenerator<ProviderEvent> {
  if (signal.aborted) throw aborted();
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  const idleMs = opts.idleTimeoutMs ?? 120_000;
  let idleFired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      idleFired = true;
      ctrl.abort();
    }, idleMs);
  };

  try {
    arm();
    const res = await p.http.fetch(joinUrl(p.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        ...opts.headers,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw await errorFromResponse(res);

    const mapper = createChunkMapper({ splitThinkTags: opts.splitThinkTags });
    const generationId = res.headers.get('x-generation-id');
    if (generationId) yield { type: 'meta', generationRef: generationId };
    const mapEvents = (chunk: unknown) =>
      mapper
        .map(chunk)
        .filter((e) => !(generationId && e.type === 'meta' && e.generationRef !== undefined));

    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    if (contentType.includes('application/json')) {
      let json: unknown;
      try {
        json = JSON.parse(await res.text());
      } catch {
        throw new ProviderError('bad_response', NOT_A_STREAM);
      }
      const errorField = (json as { error?: unknown } | null)?.error;
      const hasError = typeof errorField === 'object' && errorField !== null;
      if (!isCompletion(json) && !hasError) throw new ProviderError('bad_response', NOT_A_STREAM);
      yield* mapEvents(isCompletion(json) ? completionToChunk(json) : json);
      yield* mapper.flush();
      return;
    }
    if (contentType !== '' && !contentType.includes('text/event-stream')) {
      throw new ProviderError('bad_response', NOT_A_STREAM);
    }
    if (!res.body) throw new ProviderError('bad_response', NOT_A_STREAM);

    let badLines = 0;
    let done = false;
    for await (const msg of parseSSE(res.body, ctrl.signal)) {
      arm();
      if (msg.kind === 'comment') {
        if (msg.text.includes('PROCESSING')) yield { type: 'processing' };
        continue;
      }
      if (msg.data === '[DONE]') {
        done = true;
        break;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(msg.data);
      } catch {
        if (++badLines >= MAX_BAD_LINES) {
          throw new ProviderError(
            'bad_response',
            'The endpoint sent data that is not a valid chat stream.',
          );
        }
        continue;
      }
      badLines = 0;
      yield* mapEvents(parsed);
    }
    if (!done) {
      // parseSSE returns quietly when its signal aborts; tell the caller why it ended.
      if (idleFired) throw idleError();
      if (signal.aborted) throw aborted();
    }
    yield* mapper.flush();
  } catch (e) {
    if (idleFired) throw idleError();
    throw errorFromException(e, signal);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    ctrl.abort();
  }
}

function idleError(): ProviderError {
  return new ProviderError('timeout', 'The model stopped sending data for 2 minutes.');
}
