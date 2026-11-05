import { normalizeSourceUrl, type Source } from '@neotext/shared';
import type { LinkMark, RenderOptions } from '../markdown/render';

/** The class the answer's citation links get; the chip itself is drawn by Markdown's CSS. */
export const CITE_CLASS = 'md-cite';

/**
 * Marks links in an answer that point at one of its sources, so they show as numbered chips.
 * Matching goes through the same normalization the server uses to deduplicate sources.
 */
export function citationLinks(sources: Source[]): NonNullable<RenderOptions['linkClass']> {
  const byUrl = new Map<string, number>();
  for (const s of sources) {
    const key = normalizeSourceUrl(s.url);
    if (key !== null && !byUrl.has(key)) byUrl.set(key, s.n);
  }
  return (href: string): LinkMark | null => {
    const key = normalizeSourceUrl(href);
    const n = key === null ? undefined : byUrl.get(key);
    return n === undefined ? null : { className: CITE_CLASS, attrs: { 'data-source': String(n) } };
  };
}

/** The source a citation chip points at, if it is one. */
export function sourceForCitation(el: Element, sources: Source[]): Source | undefined {
  const n = Number(el.getAttribute('data-source'));
  return Number.isInteger(n) ? sources.find((s) => s.n === n) : undefined;
}
