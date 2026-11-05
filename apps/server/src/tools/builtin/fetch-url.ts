import { createSemaphore, type Semaphore } from '../../lib/semaphore';
import { BlockedUrlError, checkUrlShape } from '../../net/ssrf';
import type { ToolSource } from '../registry';
import type { ToolContext, ToolDefinition, ToolResult } from '../types';
import { ComplexPageError, parseHtml } from './html-parse';

export const FETCH_MAX_BYTES = 2 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 10_000;
export const FETCH_TEXT_MAX = 12_000;
export const MAX_REDIRECTS = 5;
/** Pages one generation loads at once; further `fetch_url` calls wait for a slot. */
export const FETCH_URL_CONCURRENCY = 4;

/** The `fetchSlots` of one generation's tool context. */
export const createFetchSlots = (): Semaphore => createSemaphore(FETCH_URL_CONCURRENCY);

const BLOCKED: ToolResult = { ok: false, error: 'This address is not allowed.' };
const STOPPED = 'This request was stopped.';
const fail = (error: string): ToolResult => ({ ok: false, error });

/** True when the error is, or was caused by, a refused address (undici wraps connect errors). */
function isBlocked(err: unknown): boolean {
  for (let e = err, depth = 0; e && depth < 8; depth++) {
    if (e instanceof BlockedUrlError) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** Reads at most `FETCH_MAX_BYTES` and cancels the rest of the body. */
async function readCapped(res: Response): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < FETCH_MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
  } finally {
    // Cancels when the limit was hit; a finished stream ignores it.
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(Math.min(size, FETCH_MAX_BYTES));
  let at = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.length - at);
    bytes.set(part, at);
    at += part.length;
    if (at >= bytes.length) break;
  }
  return bytes;
}

function decode(bytes: Uint8Array, contentType: string): string {
  const charset = /charset\s*=\s*"?([\w-]+)/i.exec(contentType)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

type Kind = 'html' | 'text' | null;
function kindOf(contentType: string): Kind {
  const type = contentType.split(/[;,]/)[0]?.trim().toLowerCase() ?? '';
  if (type === 'text/html' || type === 'application/xhtml+xml') return 'html';
  if (type.startsWith('text/') || type === 'application/json' || type.endsWith('+json')) {
    return 'text';
  }
  return null;
}

/** Follows redirects by hand so every hop is checked before it is requested. */
async function fetchFollowing(
  start: string,
  ctx: ToolContext,
  signal: AbortSignal,
): Promise<{ res: Response; url: string }> {
  let url = start;
  for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
    checkUrlShape(url);
    const res = await ctx.http.fetch(url, {
      redirect: 'manual',
      signal,
      headers: { accept: 'text/html,text/plain;q=0.9,*/*;q=0.1', 'user-agent': 'NeoText/0.1' },
    });
    if (res.status < 300 || res.status >= 400) return { res, url };
    await res.body?.cancel().catch(() => {});
    const location = res.headers.get('location');
    if (!location) throw new RedirectError('The link redirected without saying where to.');
    url = new URL(location, url).href;
  }
  throw new RedirectError('The link redirected too many times.');
}

class RedirectError extends Error {}

async function execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const url = (args as { url?: unknown } | null)?.url;
  if (typeof url !== 'string' || url.trim() === '') {
    return fail('Give the full address of the page as "url".');
  }
  return ctx.fetchSlots(() => load(url.trim(), ctx));
}

/** Loads and reads one page while it holds a slot; its time limit starts with the slot. */
async function load(url: string, ctx: ToolContext): Promise<ToolResult> {
  if (ctx.signal.aborted) return fail(STOPPED);
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]);
  try {
    const { res, url: finalUrl } = await fetchFollowing(url, ctx, signal);
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return fail(`The page answered with status ${res.status}.`);
    }
    const contentType = res.headers.get('content-type') ?? '';
    const kind = kindOf(contentType);
    if (!kind) {
      await res.body?.cancel().catch(() => {});
      return fail('This link is not a text page.');
    }
    const raw = decode(await readCapped(res), contentType);
    const page = kind === 'html' ? await parseHtml(raw, finalUrl, { signal: ctx.signal }) : null;
    const title = page?.title ?? '';
    const text = (page?.text ?? raw.replace(/\n{3,}/g, '\n\n').trim()).slice(0, FETCH_TEXT_MAX);
    if (!text) return fail('This page has no readable text.');
    return {
      ok: true,
      content: `Title: ${title}\nURL: ${finalUrl}\n\n${text}`,
      sources: [{ url: finalUrl, title: title || finalUrl, content: text }],
    };
  } catch (err) {
    if (isBlocked(err)) return BLOCKED;
    if (err instanceof RedirectError || err instanceof ComplexPageError) return fail(err.message);
    if (ctx.signal.aborted) return fail(STOPPED);
    if (signal.aborted) return fail('The page took too long to load.');
    ctx.log.info({ err: err instanceof Error ? err.name : 'unknown' }, 'fetch_url failed');
    return fail('The page could not be loaded.');
  }
}

export const fetchUrlTool: ToolDefinition = {
  name: 'fetch_url',
  description:
    'Read the text of a web page. Use when the user shares a link or you need the content of a specific page.',
  parameters: {
    type: 'object',
    properties: { url: { type: 'string', description: 'The full http or https address.' } },
    required: ['url'],
    additionalProperties: false,
  },
  source: 'app',
  defaultPolicy: 'auto',
  execute,
};

/**
 * Offered when web search is on or the message holds a link, so plain chats send no tools;
 * the settings listing (no turn) always includes it.
 */
export const fetchUrlSource: ToolSource = (_auth, turn) =>
  turn === null || turn.webSearch || /https?:\/\//.test(turn.userText) ? [fetchUrlTool] : [];
