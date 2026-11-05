import { isJsonObject } from './merge-patch';

/**
 * Dotted paths where `raw` held a value that `parsed` replaced. Paths absent from `raw`
 * (filled with defaults) are never reported. Arrays of equal length are compared by index.
 */
export function findResetPaths(raw: unknown, parsed: unknown): string[] {
  const out: string[] = [];
  walk(raw, parsed, '', out);
  return out;
}

function walk(raw: unknown, parsed: unknown, path: string, out: string[]): void {
  if (isJsonObject(raw) && isJsonObject(parsed)) {
    for (const key of new Set([...Object.keys(raw), ...Object.keys(parsed)])) {
      if (raw[key] === undefined) continue;
      walk(raw[key], parsed[key], path ? `${path}.${key}` : key, out);
    }
    return;
  }
  if (Array.isArray(raw) && Array.isArray(parsed) && raw.length === parsed.length) {
    raw.forEach((item, i) => {
      walk(item, parsed[i], path ? `${path}.${i}` : String(i), out);
    });
    return;
  }
  if (path && !sameValue(raw, parsed)) out.push(path);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
