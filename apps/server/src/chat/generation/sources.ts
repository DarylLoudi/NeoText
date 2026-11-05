import type { Source } from '@neotext/shared';
import { domainOf, normalizeSourceUrl } from '@neotext/shared';

export const SNIPPET_MAX = 400;
const TITLE_MAX = 300;
const ELLIPSIS = '…';

/** Plain-text excerpt of search result content: no markdown, one line, at most 400 chars. */
export function toSnippet(content: string): string {
  const plain = content
    .replace(/```[\w-]*/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/(\*\*|__|\*|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= SNIPPET_MAX) return plain;
  const room = plain.slice(0, SNIPPET_MAX - ELLIPSIS.length + 1);
  const lastSpace = room.lastIndexOf(' ');
  const cut = lastSpace > 0 ? room.slice(0, lastSpace) : room.slice(0, SNIPPET_MAX - 1);
  return `${cut.trimEnd()}${ELLIPSIS}`;
}

export interface SourceCollector {
  add(c: { url: string; title: string; content: string }): Source | null;
  all(): Source[];
}

export function createSourceCollector(): SourceCollector {
  const seen = new Set<string>();
  const list: Source[] = [];
  return {
    add: (c) => {
      const key = normalizeSourceUrl(c.url);
      if (key === null || seen.has(key)) return null;
      seen.add(key);
      const domain = domainOf(c.url);
      const title = c.title.trim() === '' ? domain : c.title.trim();
      const source: Source = {
        n: list.length + 1,
        url: c.url,
        title: title.slice(0, TITLE_MAX),
        domain,
        snippet: toSnippet(c.content),
      };
      list.push(source);
      return source;
    },
    all: () => list.map((s) => ({ ...s })),
  };
}
