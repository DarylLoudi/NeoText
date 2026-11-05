import { describe, expect, test } from 'vitest';
import { BlockedUrlError } from '../net/ssrf';
import {
  errorFromChunk,
  errorFromException,
  errorFromResponse,
  NOT_A_STREAM,
  ProviderError,
} from './errors';

const res = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers });

describe('errorFromResponse', () => {
  test.each([
    [401, 'auth', false],
    [403, 'auth', false],
    [402, 'insufficient_credits', false],
    [404, 'model_not_found', false],
    [408, 'timeout', false],
    [504, 'timeout', false],
    [413, 'context_length', false],
    [422, 'bad_request', false],
    [500, 'upstream', true],
    [503, 'upstream', true],
  ])('status %i is %s', async (status, code, retryable) => {
    const e = await errorFromResponse(res(status, '{"error":{"message":"nope"}}'));
    expect(e).toBeInstanceOf(ProviderError);
    expect(e).toMatchObject({ code, retryable, status, message: 'nope' });
  });

  test('400 mentioning context is context_length', async () => {
    const e = await errorFromResponse(
      res(400, '{"error":{"message":"maximum context length exceeded"}}'),
    );
    expect(e.code).toBe('context_length');
    expect((await errorFromResponse(res(400, '{"error":{"message":"bad"}}'))).code).toBe(
      'bad_request',
    );
  });

  test('429 carries Retry-After seconds', async () => {
    const e = await errorFromResponse(res(429, '{}', { 'retry-after': '2' }));
    expect(e).toMatchObject({ code: 'rate_limit', retryable: true, retryAfterMs: 2000 });
  });

  test('429 without a usable Retry-After has retryAfterMs null', async () => {
    expect((await errorFromResponse(res(429, '{}'))).retryAfterMs).toBeNull();
    expect(
      (await errorFromResponse(res(429, '{}', { 'retry-after': '' }))).retryAfterMs,
    ).toBeNull();
    expect((await errorFromResponse(res(429, '{}', { 'retry-after': '0' }))).retryAfterMs).toBe(0);
  });

  test('non-JSON bodies get a short generic message, never the raw body', async () => {
    const e = await errorFromResponse(res(500, '<html><body>Bad Gateway</body></html>'));
    expect(e).toMatchObject({ code: 'upstream', message: 'The endpoint returned HTTP 500.' });
  });

  test.each([404, 405])('a non-JSON %i means the base URL is wrong', async (status) => {
    for (const body of ['<!doctype html><html><h1>Not Found</h1></html>', 'Cannot POST', '']) {
      const e = await errorFromResponse(res(status, body, { 'content-type': 'text/html' }));
      expect(e).toMatchObject({ code: 'bad_response', message: NOT_A_STREAM, status });
      expect(e.message).toContain('/v1');
      expect(e.message).not.toContain('<');
    }
  });

  test('a 404 with a JSON error body is still model_not_found', async () => {
    const e = await errorFromResponse(res(404, '{"error":{"message":"No such model"}}'));
    expect(e).toMatchObject({ code: 'model_not_found', message: 'No such model' });
  });
});

describe('errorFromChunk', () => {
  test('maps provider codes', () => {
    expect(errorFromChunk({ code: 'server_error', message: 'boom' })).toMatchObject({
      code: 'upstream',
      retryable: true,
      message: 'boom',
    });
    expect(errorFromChunk({ code: 502, message: 'x' }).code).toBe('upstream');
    expect(errorFromChunk({ code: 'rate_limit_exceeded', message: 'x' }).code).toBe('rate_limit');
    expect(errorFromChunk({ code: 429, message: 'x' }).code).toBe('rate_limit');
    expect(errorFromChunk({ code: 'weird', message: 'x' }).code).toBe('bad_request');
  });
});

describe('errorFromException', () => {
  const blocked = () => new BlockedUrlError('private', 'blocked');

  test('literal-IP shape: BlockedUrlError thrown directly', () => {
    expect(errorFromException(blocked())).toMatchObject({
      code: 'bad_request',
      message: 'This address is not allowed for this endpoint.',
    });
  });

  test('DNS-time shape: TypeError "fetch failed" with the BlockedUrlError in cause', () => {
    const e = new TypeError('fetch failed', { cause: new Error('connect', { cause: blocked() }) });
    expect(errorFromException(e)).toMatchObject({
      code: 'bad_request',
      message: 'This address is not allowed for this endpoint.',
    });
  });

  test('a timed-out signal is a timeout, not a cancel', async () => {
    const signal = AbortSignal.timeout(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(errorFromException(new Error('x'), signal).code).toBe('timeout');
  });

  test('aborted signal wins, anything else is network', () => {
    const ac = new AbortController();
    ac.abort();
    expect(errorFromException(new Error('x'), ac.signal).code).toBe('aborted');
    expect(errorFromException(new TypeError('fetch failed')).code).toBe('network');
  });

  test('a ProviderError passes through', () => {
    const pe = new ProviderError('auth', 'no');
    expect(errorFromException(pe)).toBe(pe);
  });
});
