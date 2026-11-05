import type { ResolvedProvider } from '../../providers/types';
import { SearchError, type SearchResult } from '../types';

const MAX_BODY_BYTES = 1024 * 1024;
const TITLE_MAX = 300;
const SNIPPET_MAX = 1000;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntity(match: string, entity: string): string {
  if (entity.startsWith('#')) {
    const hex = entity[1]?.toLowerCase() === 'x';
    const code = hex ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  }
  return ENTITIES[entity.toLowerCase()] ?? match;
}

/** Turns markup in a snippet into plain text; nothing is ever rendered as HTML. */
export function plainText(value: string, max: number): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, decodeEntity)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const asRecord = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {});

/** Keeps entries with an http(s) url and a title; drops anything else, and anything past `count`. */
export function mapResults(items: unknown, snippetField: string, count: number): SearchResult[] {
  if (!Array.isArray(items)) return [];
  const out: SearchResult[] = [];
  for (const item of items) {
    if (out.length >= count) break;
    if (!isRecord(item)) continue;
    const { url, title } = item;
    const snippet = item[snippetField];
    if (typeof url !== 'string' || typeof title !== 'string') continue;
    if (!/^https?:\/\//i.test(url)) continue;
    const cleanTitle = plainText(title, TITLE_MAX);
    if (!cleanTitle) continue;
    out.push({
      url,
      title: cleanTitle,
      snippet: typeof snippet === 'string' ? plainText(snippet, SNIPPET_MAX) : '',
    });
  }
  return out;
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`;
}

/** Reads the body as text, giving up as soon as it passes the size cap. */
async function readCapped(res: Response): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BODY_BYTES) throw new SearchError('The search answer was too large.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Sends the request and parses the JSON answer; any non-2xx status is a SearchError. */
export async function requestJson(
  p: ResolvedProvider,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<unknown> {
  const res = await p.http.fetch(url, {
    ...init,
    signal,
    headers: { accept: 'application/json', 'user-agent': 'NeoText/0.1', ...init.headers },
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new SearchError(`The search service answered with status ${res.status}.`, res.status);
  }
  const text = await readCapped(res);
  try {
    return JSON.parse(text);
  } catch {
    throw new SearchError('The search service did not answer with JSON.');
  }
}
