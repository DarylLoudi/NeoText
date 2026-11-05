export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** RFC 7396 JSON Merge Patch. Returns a new value; neither input is mutated or aliased. */
export function applyMergePatch<T>(target: T, patch: unknown): T {
  return merge(target, patch) as T;
}

function merge(target: unknown, patch: unknown): unknown {
  if (!isJsonObject(patch)) return structuredClone(patch);
  const result: JsonObject = isJsonObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === '__proto__') continue;
    if (value === null) {
      delete result[key];
    } else {
      result[key] = merge(result[key], value);
    }
  }
  return result;
}
