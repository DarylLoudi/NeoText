type Fragment = Record<string, unknown>;

const isFragment = (v: unknown): v is Fragment =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Streamed `reasoning_details` arrive as many fragments of the same detail. Fragments with the
 * same `index` and `type` are merged: `text` and `summary` concatenate, other fields (such as
 * `signature`, `data`, `format`, `id`) come from the fragment that has them. First-seen order is
 * kept; fragments without a numeric index, or that are not objects, pass through unchanged.
 */
export function mergeReasoningDetails(fragments: unknown[]): unknown[] {
  const out: unknown[] = [];
  const byKey = new Map<string, Fragment>();
  for (const f of fragments) {
    if (!isFragment(f) || typeof f.index !== 'number') {
      out.push(f);
      continue;
    }
    const key = `${f.index}\u0000${String(f.type)}`;
    const merged = byKey.get(key);
    if (!merged) {
      const first = { ...f };
      byKey.set(key, first);
      out.push(first);
      continue;
    }
    for (const [field, value] of Object.entries(f)) {
      if (value === undefined || value === null) continue;
      if ((field === 'text' || field === 'summary') && typeof value === 'string') {
        merged[field] = `${typeof merged[field] === 'string' ? merged[field] : ''}${value}`;
      } else if (merged[field] === undefined || merged[field] === null) {
        merged[field] = value;
      }
    }
  }
  return out;
}
