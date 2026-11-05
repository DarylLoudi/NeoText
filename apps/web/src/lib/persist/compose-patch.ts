import { isJsonObject, type JsonObject } from '@neotext/shared';

/**
 * Folds two JSON Merge Patches (RFC 7396) into one: objects merge key by key, `null` deletions
 * from either side are kept, and arrays and primitives from `b` win. Neither input is mutated.
 *
 * The result equals applying `a` then `b` whenever `canComposePatches(a, b)` is true.
 */
export function composePatches(a: JsonObject, b: JsonObject): JsonObject {
  const out: JsonObject = structuredClone(a);
  for (const [key, value] of Object.entries(b)) {
    if (key === '__proto__') continue;
    const prev = out[key];
    out[key] =
      isJsonObject(value) && isJsonObject(prev)
        ? composePatches(prev, value)
        : structuredClone(value);
  }
  return out;
}

/**
 * False when `b` writes an object where `a` deletes or sets a non-object: applied in turn,
 * `b` would start from an empty object, which one merge patch cannot say. Such pairs must be
 * sent as separate requests, in order.
 */
export function canComposePatches(a: JsonObject, b: JsonObject): boolean {
  for (const [key, value] of Object.entries(b)) {
    if (!isJsonObject(value) || !Object.hasOwn(a, key)) continue;
    const prev = a[key];
    if (!isJsonObject(prev)) return false;
    if (!canComposePatches(prev, value)) return false;
  }
  return true;
}
