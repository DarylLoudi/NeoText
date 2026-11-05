import type { Snippet } from '@neotext/shared';

/** A `{{name}}` placeholder; the name may hold letters, digits, `_`, spaces and dashes. */
const VARIABLE = /\{\{\s*([\w -]{1,40}?)\s*\}\}/g;

/** The distinct variable names in `body`, in order of first use. */
export function extractVariables(body: string): string[] {
  const names: string[] = [];
  for (const match of body.matchAll(VARIABLE)) {
    const name = match[1];
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
}

/** Replaces each placeholder that has a value; the others stay as they are. */
export function fillVariables(body: string, values: Record<string, string>): string {
  return body.replace(VARIABLE, (whole, name: string) =>
    Object.hasOwn(values, name) ? (values[name] ?? whole) : whole,
  );
}

/** Start of the line the cursor is on. */
export function lineStart(text: string, cursor: number): number {
  return text.lastIndexOf('\n', cursor - 1) + 1;
}

/**
 * The text typed after a `/` that starts the cursor's line, while no space has followed it;
 * null when the cursor is not in such a word.
 */
export function slashQuery(text: string, cursor: number): string | null {
  const line = text.slice(lineStart(text, cursor), cursor);
  if (!line.startsWith('/')) return null;
  const query = line.slice(1);
  return /\s/.test(query) ? null : query;
}

/** Snippets whose trigger starts with `query` first, then those whose title contains it. */
export function matchSnippets(snippets: Snippet[], query: string): Snippet[] {
  const q = query.toLowerCase();
  if (q === '') return [...snippets];
  const byTrigger = snippets.filter((s) => s.trigger.startsWith(q));
  const byTitle = snippets.filter(
    (s) => !s.trigger.startsWith(q) && s.title.toLowerCase().includes(q),
  );
  return [...byTrigger, ...byTitle];
}
