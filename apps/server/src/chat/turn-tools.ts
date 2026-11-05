import type { ChatRequestBody, ModelInfo, ModelRef, UserSettings } from '@neotext/shared';
import type { AuthContext } from '../http/env';
import type { ProviderService } from '../providers/service';
import { assembleToolSet } from '../tools/registry';
import type { ToolContext, ToolDefinition, ToolSet } from '../tools/types';
import type { WebSearchPlan } from './generation/web-search';
import type { MessagesRepo } from './messages-repo';

/**
 * Whether a target may get tools: only a model that reports no tool support is ruled out.
 * Unknown support, or a model missing from the cache, counts as possible for every provider.
 */
export function toolsPossible(model: ModelInfo | null): boolean {
  return model?.supports.tools !== false;
}

/**
 * The tool loop fields of one target's run: none when the model cannot use tools or no tool is
 * left after the user's policies, so such a request carries no `tools` field.
 */
export function turnToolFields(input: {
  available: ToolDefinition[];
  settings: UserSettings['tools'];
  model: ModelInfo | null;
  context: ToolContext;
}): { tools?: ToolSet; maxSteps?: number; toolContext?: ToolContext } {
  if (!toolsPossible(input.model) || input.available.length === 0) return {};
  const tools = assembleToolSet(input.available, input.settings.policies);
  if (tools.defs.length === 0) return {};
  return { tools, maxSteps: input.settings.maxSteps, toolContext: input.context };
}

/**
 * True when some target may use tools, so the tool lists are worth fetching. A target whose
 * provider cannot be resolved counts as not; the turn fails on it properly later.
 */
export function anyTargetMayUseTools(
  auth: AuthContext,
  targets: ModelRef[],
  providers: Pick<ProviderService, 'resolveEnabled' | 'cachedModel'>,
): boolean {
  return targets.some((ref) => {
    try {
      providers.resolveEnabled(auth, ref.providerId);
      return toolsPossible(providers.cachedModel(ref.providerId, ref.modelId));
    } catch {
      return false;
    }
  });
}

/** The text the turn answers: the new message, or the user message being regenerated. */
export function turnText(
  auth: AuthContext,
  body: ChatRequestBody,
  messages: Pick<MessagesRepo, 'get'>,
): string {
  if (body.userMessage) return body.userMessage.text;
  if (body.parentId === null) return '';
  try {
    const parent = messages.get(body.parentId, auth.dek);
    if (parent?.userId !== auth.userId) return '';
    return parent.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('');
  } catch {
    return '';
  }
}

/**
 * The tools of one target: its web search plan's `web_search` comes first and replaces any other
 * tool of that name; every other plan adds none.
 */
export function toolsForTarget(available: ToolDefinition[], plan: WebSearchPlan): ToolDefinition[] {
  if (plan.kind !== 'tool') return available;
  return [plan.tool, ...available.filter((t) => t.name !== plan.tool.name)];
}
