export type Tree = { [key: string]: string | Tree };

/** Flattens a nested locale tree into `a.b.c` keys. */
export function flatEntries(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, flatEntries(value, path));
  }
  return out;
}

/** Sorted, unique `{{variable}}` names used by one translation string. */
export function interpolationVars(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*([\w.]+)\s*(?:,[^}]*)?\}\}/g)) {
    if (m[1]) names.add(m[1]);
  }
  return [...names].sort();
}
