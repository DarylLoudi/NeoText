import {
  type ConversationSummary,
  type ModelInfo,
  type ModelRef,
  modelKey,
  parseModelKey,
  type UserSettings,
} from '@neotext/shared';

/** The model keys of a catalog, remembered per array so a re-render does not rebuild them. */
const keySets = new WeakMap<ModelInfo[], Set<string>>();

function keysOf(models: ModelInfo[]): Set<string> {
  let keys = keySets.get(models);
  if (!keys) {
    keys = new Set(models.map((m) => modelKey({ providerId: m.providerId, modelId: m.id })));
    keySets.set(models, keys);
  }
  return keys;
}

/**
 * The model the next message goes to: the one just picked, else the chat's own, else the
 * default from settings, else the first favorite, else the first model there is. A choice that
 * is no longer in the catalog (removed, hidden, provider turned off) is passed over.
 */
export function resolveModel(
  conversation: ConversationSummary | null,
  settings: UserSettings,
  models: ModelInfo[],
  pending: ModelRef | null,
): ModelRef | null {
  const available = keysOf(models);
  const candidates: (ModelRef | null)[] = [
    pending,
    conversation?.modelRef ?? null,
    settings.chat.defaultModel,
    ...settings.models.favorites.map(parseModelKey),
  ];
  for (const ref of candidates) {
    if (ref && available.has(modelKey(ref))) return ref;
  }
  const first = models[0];
  return first ? { providerId: first.providerId, modelId: first.id } : null;
}
