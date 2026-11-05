import type { ModelInfo } from '@neotext/shared';
import { modelKey } from '@neotext/shared';

/** Lowercased name and id, made once per model: a keystroke then only runs `includes`. */
const haystacks = new WeakMap<ModelInfo, string>();

function haystack(m: ModelInfo): string {
  let h = haystacks.get(m);
  if (h === undefined) {
    h = `${m.name}\n${m.id}`.toLowerCase();
    haystacks.set(m, h);
  }
  return h;
}

/**
 * The models whose name and id together contain every word of `query`, in catalog order.
 * An empty query lists everything, with `favorites` (model keys) moved to the front.
 */
export function searchModels(
  models: ModelInfo[],
  query: string,
  favorites?: ReadonlySet<string>,
): ModelInfo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    if (!favorites || favorites.size === 0) return models;
    const starred = models.filter((m) => favorites.has(modelKey(toRef(m))));
    return [...starred, ...models.filter((m) => !favorites.has(modelKey(toRef(m))))];
  }
  return models.filter((m) => {
    const h = haystack(m);
    return words.every((w) => h.includes(w));
  });
}

export function toRef(m: ModelInfo): { providerId: string; modelId: string } {
  return { providerId: m.providerId, modelId: m.id };
}
