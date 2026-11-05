import {
  type ProviderCategory,
  type ProviderKind,
  SearchProviderKindSchema,
} from '@neotext/shared';

/** Search backends (SearXNG, Brave, Tavily) are providers too, kept apart from model ones. */
export function kindCategory(kind: ProviderKind): ProviderCategory {
  return SearchProviderKindSchema.safeParse(kind).success ? 'search' : 'llm';
}

/** Lines of "Name: value" to a header map; null when a line is not in that shape. */
export function parseHeaders(text: string): Record<string, string> | null {
  const headers: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const at = line.indexOf(':');
    const name = at > 0 ? line.slice(0, at).trim() : '';
    const value = at > 0 ? line.slice(at + 1).trim() : '';
    if (!name || !value || /\s/.test(name)) return null;
    headers[name] = value;
  }
  return headers;
}

/** One id per line, without blanks or repeats. */
export function parseModelIds(text: string): string[] {
  return [
    ...new Set(
      text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    ),
  ];
}

export const MAX_HEADERS = 10;
export const MAX_MODEL_IDS = 200;
