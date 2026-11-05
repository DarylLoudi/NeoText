import type { AgentPublic, ChatRequestBody, MessagePublic, ModelRef } from '@neotext/shared';
import type { AgentsService } from '../agents/service';
import type { AuthContext } from '../http/env';
import { AppError } from '../http/errors';
import type { ProviderService } from '../providers/service';
import type { QuotaService } from '../quotas/service';
import { assertSharedQuota } from './turn-quota';

/**
 * The custom agent a turn is addressed to, if any. A regenerate or an edit of an answer whose
 * agent is gone (deleted, turned off, or from an imported chat) answers as a plain message; only
 * a new message to it is refused.
 */
export function resolveTurnAgent(
  agents: Pick<AgentsService, 'get'>,
  auth: AuthContext,
  body: ChatRequestBody,
  history: MessagePublic[],
): AgentPublic | null {
  const { agentId } = body.options;
  const found = agentId ? agents.get(auth, agentId) : null;
  const agent = found?.data.enabled ? found : null;
  const resend =
    body.userMessage === null ||
    history.some((m) => m.role === 'user' && m.parentId === body.parentId);
  if (agentId && !agent && !resend) {
    throw new AppError('agent_not_found', 'That agent is missing or turned off.', 404);
  }
  if (agent && body.targets.length > 1) {
    throw new AppError(
      'agent_single_target',
      'An agent answers with one model. Pick a single model and try again.',
      400,
    );
  }
  return agent;
}

/** The models a turn runs on: the agent's own model when it has one, else the request's. */
export function agentTargets(
  deps: { providers: ProviderService; quotas: QuotaService },
  auth: AuthContext,
  agent: AgentPublic | null,
  body: ChatRequestBody,
): ModelRef[] {
  const ref = agent?.data.model;
  if (!ref) return body.targets;
  try {
    if (deps.providers.isSearchBackend(auth, ref.providerId)) throw new Error('search');
    deps.providers.resolveEnabled(auth, ref.providerId);
  } catch {
    throw new AppError(
      'agent_model_unavailable',
      "This agent's model is no longer available. Edit the agent to pick another.",
      400,
    );
  }
  assertSharedQuota(deps, auth, [ref]);
  return [ref];
}
