import type { MessagePublic, ModelInfo, UserSettings } from '@neotext/shared';
import { modelKey } from '@neotext/shared';

/** The model's context window, with the user's own figure for it (Settings, Models) first. */
export function effectiveContextLength(
  model: Pick<ModelInfo, 'providerId' | 'id' | 'contextLength'> | null,
  overrides: UserSettings['models']['overrides'],
): number | null {
  if (!model) return null;
  const own = overrides[modelKey({ providerId: model.providerId, modelId: model.id })];
  return own?.contextLength ?? model.contextLength;
}

/**
 * Whether picking a model with context window `next` in a chat that has messages should start a
 * new chat instead: only when both sizes are known and differ.
 */
export function needsNewChat(current: number | null, next: number | null): boolean {
  return current !== null && next !== null && current !== next;
}

/**
 * Tokens the context of the latest answer on the current branch holds, or null before any: the
 * last model call's prompt and output (`contextTokens`). Answers stored before that field use
 * the sum over the answer's calls, which overstates it after tool steps.
 */
export function usedContextTokens(
  messages: MessagePublic[],
  activeLeafId: string | null,
): number | null {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const seen = new Set<string>();
  for (let m = activeLeafId ? byId.get(activeLeafId) : undefined; m && !seen.has(m.id); ) {
    seen.add(m.id);
    if (m.role === 'assistant' && m.usage) {
      return m.usage.contextTokens ?? m.usage.promptTokens + m.usage.completionTokens;
    }
    m = m.parentId ? byId.get(m.parentId) : undefined;
  }
  return null;
}

/** The bar turns to the danger color from here (there is no non-yellow warning token). */
export const CONTEXT_DANGER_RATIO = 0.9;
