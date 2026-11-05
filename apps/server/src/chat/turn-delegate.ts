import type { AgentPublic, ModelInfo, ModelRef, UserSettings } from '@neotext/shared';
import type { AgentsService } from '../agents/service';
import type { AuthContext } from '../http/env';
import type { Clock } from '../lib/clock';
import type { Logger } from '../lib/logger';
import { getAdapter } from '../providers/registry';
import type { ProviderService } from '../providers/service';
import type { ResolvedProvider } from '../providers/types';
import type { QuotaService } from '../quotas/service';
import {
  createDelegateTool,
  DELEGATE_TOOL,
  type DelegateDeps,
  type SubagentModel,
  type SubagentTools,
} from '../tools/builtin/delegate';
import { fetchUrlTool } from '../tools/builtin/fetch-url';
import type { ToolDefinition } from '../tools/types';
import type { UsageRepo } from '../usage/repo';
import type { WebSearchPlan } from './generation/web-search';
import { assertSharedQuota } from './turn-quota';
import { toolsPossible } from './turn-tools';

export interface DelegationDeps {
  agents: Pick<AgentsService, 'list'>;
  providers: Pick<
    ProviderService,
    'resolveEnabled' | 'cachedModel' | 'isSearchBackend' | 'isShared'
  >;
  /** The admin's shared-provider limit, checked as the turn checks it. */
  quotas: Pick<QuotaService, 'assertWithin'>;
  usage: UsageRepo;
  clock: Clock;
  log: Logger;
}

/**
 * Whether a target is offered `delegate_tasks`: its model may use tools and the user did not
 * turn the tool off. A direct agent call may delegate too.
 */
export function offersDelegation(input: {
  model: ModelInfo | null;
  toolSettings: UserSettings['tools'];
}): boolean {
  const policy = input.toolSettings.policies[DELEGATE_TOOL] ?? 'auto';
  return toolsPossible(input.model) && policy !== 'off';
}

export interface DelegateToolInput {
  auth: AuthContext;
  conversationId: string;
  /** The assistant message the sub-agents' usage rows belong to. */
  messageId: string;
  target: { ref: ModelRef; provider: ResolvedProvider };
  plan: WebSearchPlan;
  toolSettings: UserSettings['tools'];
  /** Searches each task may run: the user's per-turn limit. */
  searchesPerTask: number;
  endUserId: string;
}

/** The `delegate_tasks` tool of one target's answer, wired to the user's agents and models. */
export function delegateToolFor(deps: DelegationDeps, input: DelegateToolInput): ToolDefinition {
  return createDelegateTool(delegateDepsFor(deps, input));
}

/** The agents, models, tools and usage rows a target's `delegate_tasks` works with. */
export function delegateDepsFor(deps: DelegationDeps, input: DelegateToolInput): DelegateDeps {
  const { auth, target, plan, toolSettings } = input;
  let agents: AgentPublic[] = [];
  try {
    agents = deps.agents.list(auth);
  } catch (err) {
    deps.log.warn({ err: err instanceof Error ? err.name : 'unknown' }, 'agents list failed');
  }
  /** False once the member's shared quota is used up and the model runs on a shared provider. */
  const withinQuota = (ref: ModelRef): boolean => {
    try {
      assertSharedQuota(deps, auth, [ref]);
      return true;
    } catch {
      deps.log.warn({ providerId: ref.providerId }, 'sub-agent model over the shared quota');
      return false;
    }
  };
  const main: SubagentModel | null = withinQuota(target.ref)
    ? {
        adapter: getAdapter(target.provider.kind),
        provider: target.provider,
        providerId: target.ref.providerId,
        modelId: target.ref.modelId,
      }
    : null;
  /** The model when its provider is enabled, chats and is within quota; null otherwise. */
  const resolve = (ref: ModelRef | null): SubagentModel | null => {
    if (ref === null) return null;
    try {
      if (deps.providers.isSearchBackend(auth, ref.providerId)) throw new Error('search backend');
      const provider = deps.providers.resolveEnabled(auth, ref.providerId);
      if (!withinQuota(ref)) return null;
      return {
        adapter: getAdapter(provider.kind),
        provider,
        providerId: ref.providerId,
        modelId: ref.modelId,
      };
    } catch (err) {
      deps.log.warn(
        { err: err instanceof Error ? err.name : 'unknown' },
        'sub-agent model unavailable; using the next choice',
      );
      return null;
    }
  };
  // Sub-agents cannot ask for approval, so they only get tools the user lets run on their own.
  const runsAlone = (t: ToolDefinition) =>
    (toolSettings.policies[t.name] ?? t.defaultPolicy) === 'auto';
  const tools: DelegateDeps['tools'] = (model, switches, search) => {
    const out: SubagentTools = { tools: [] };
    if (!toolsPossible(deps.providers.cachedModel(model.providerId, model.modelId))) return out;
    const searches = switches.webSearch && plan.kind !== 'none' && search.share > 0;
    if (searches && plan.kind === 'server' && model.provider.kind === 'openrouter') {
      // The provider's own search: this sub-agent's share, spent from the delegation's budget.
      out.serverTools = plan.serverTools;
      out.maxServerToolCalls = search.share;
      out.searchBudget = search.budget;
    } else if (searches && (plan.kind === 'tool' || plan.kind === 'server') && plan.searchTool) {
      // The backend tool on a fresh budget; also for a non-OpenRouter model under a server plan.
      const tool = plan.searchTool(search.budget);
      if (runsAlone(tool)) out.tools.push(tool);
    }
    if (switches.fetchUrl && runsAlone(fetchUrlTool)) out.tools.push(fetchUrlTool);
    return out;
  };
  return {
    agents,
    maxSubagents: toolSettings.maxSubagents,
    searchesPerTask: input.searchesPerTask,
    model: (agentModel) => resolve(agentModel) ?? resolve(toolSettings.subagentModel) ?? main,
    tools,
    recordUsage: ({ providerId, modelId, usage }) => {
      try {
        deps.usage.insert({
          userId: auth.userId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          providerId,
          modelId,
          kind: 'tool',
          usage,
          createdAt: deps.clock.now(),
        });
      } catch (err) {
        deps.log.error({ err, conversationId: input.conversationId }, 'usage record failed');
      }
    },
    clock: deps.clock,
    endUserId: input.endUserId,
  };
}
