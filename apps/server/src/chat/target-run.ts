import {
  type AgentPublic,
  type ChatRequestBody,
  type MessagePublic,
  type ModelInfo,
  type ModelRef,
  newId,
  type UserSettings,
} from '@neotext/shared';
import type { AttachmentLookup } from '../attachments/model-file';
import type { AuthContext } from '../http/env';
import type { Clock } from '../lib/clock';
import type { Logger } from '../lib/logger';
import type { HttpClient } from '../net/http-client';
import { getAdapter } from '../providers/registry';
import type { ResolvedProvider } from '../providers/types';
import { createFetchSlots } from '../tools/builtin/fetch-url';
import type { ToolDefinition } from '../tools/types';
import { createGeneration, type Generation } from './generation/generation';
import type { GenerationManager } from './generation/manager';
import { type RunDeps, type RunSpec, runGeneration } from './generation/runner';
import { preContextFields, type WebSearchPlan } from './generation/web-search';
import { createMessageWriter } from './generation/writer';
import type { MessagesRepo } from './messages-repo';
import { type DelegationDeps, delegateToolFor, offersDelegation } from './turn-delegate';
import { buildTurnRequest } from './turn-request';
import {
  agentKnowledge,
  filterAgentTools,
  type KnowledgeLookup,
  toolsForTarget,
  toolsPossible,
  turnToolFields,
} from './turn-tools';

export interface TargetRunDeps {
  messages: MessagesRepo;
  manager: Pick<GenerationManager, 'start'>;
  runDeps: RunDeps;
  clock: Clock;
  log: Logger;
  /** Client for app tools that reach the web; private networks refused. */
  toolsHttp: HttpClient;
  /** Offers `delegate_tasks`; without it no target is offered the tool. */
  delegation?: DelegationDeps;
  /** Offers an agent with ready files `search_knowledge`. */
  knowledge?: KnowledgeLookup;
  /** The generation runner; replaced in tests. */
  run?: (spec: RunSpec, deps: RunDeps) => Promise<void>;
}

export interface TargetRunInput {
  auth: AuthContext;
  conversationId: string;
  /** The assistant message this target fills. */
  message: MessagePublic;
  target: { ref: ModelRef; provider: ResolvedProvider; model: ModelInfo | null };
  plan: WebSearchPlan;
  path: MessagePublic[];
  /** Opens files attached along the path; shared by every target of the turn. */
  loadAttachment?: AttachmentLookup;
  chat: UserSettings['chat'];
  options: ChatRequestBody['options'];
  toolSettings: UserSettings['tools'];
  /** Searches each delegated task may run: the user's per-turn search limit. */
  searchesPerTask: number;
  /** Tools of the turn before this target's web search plan is applied. */
  available: ToolDefinition[];
  userText: string;
  endUserId: string;
  now: number;
  /** A custom agent called directly: its instructions replace the system prompt. */
  agent?: AgentPublic;
  afterFinish?: (generation: Generation, final: MessagePublic) => Promise<void>;
}

/** Builds the request, generation and writer of one target and starts its run. */
export function startTargetRun(
  deps: TargetRunDeps,
  input: TargetRunInput,
): { generation: Generation; contextTrimmed: number } {
  const { auth, message, target, afterFinish } = input;
  // An agent with web search off gets none, on any path: no provider search, tool or guidance.
  const plan: WebSearchPlan =
    input.agent?.data.tools.webSearch === false ? { kind: 'none' } : input.plan;
  const delegate =
    deps.delegation && offersDelegation({ model: target.model, toolSettings: input.toolSettings })
      ? [
          delegateToolFor(deps.delegation, {
            auth,
            conversationId: input.conversationId,
            messageId: message.id,
            target,
            plan,
            toolSettings: input.toolSettings,
            searchesPerTask: input.searchesPerTask,
            endUserId: input.endUserId,
          }),
        ]
      : [];
  const knowledge =
    input.agent && deps.knowledge && toolsPossible(target.model)
      ? agentKnowledge(deps.knowledge, auth, input.agent, input.toolSettings.policies)
      : null;
  const turn = buildTurnRequest({
    path: input.path,
    chat: input.chat,
    options: input.options,
    modelId: target.ref.modelId,
    model: target.model,
    plan,
    endUserId: input.endUserId,
    now: input.now,
    ...(input.agent ? { systemPrompt: input.agent.data.instructions } : {}),
    ...(delegate.length > 0 ? { delegation: true } : {}),
    ...(knowledge ? { knowledgeGuidance: knowledge.guidance } : {}),
    ...(input.loadAttachment ? { loadAttachment: input.loadAttachment } : {}),
  });
  const generation = createGeneration({
    id: newId('gen'),
    userId: auth.userId,
    conversationId: input.conversationId,
    message,
    model: target.ref,
    startedAt: input.now,
    log: deps.log,
  });
  const writer = createMessageWriter({
    messages: deps.messages,
    dek: auth.dek,
    messageId: message.id,
    clock: deps.clock,
    log: deps.log,
  });
  const run = deps.run ?? runGeneration;
  deps.manager.start(generation, (g) =>
    run(
      {
        generation: g,
        adapter: getAdapter(target.provider.kind),
        provider: target.provider,
        request: turn.request,
        webSearch: turn.webSearch,
        writer,
        userId: auth.userId,
        conversationId: input.conversationId,
        model: target.ref,
        ...preContextFields(plan, input.userText),
        ...(plan.kind === 'server' || plan.kind === 'tool' ? { searchBudget: plan.budget } : {}),
        ...turnToolFields({
          available: [
            ...toolsForTarget(
              input.agent ? filterAgentTools(input.available, input.agent) : input.available,
              plan,
            ),
            ...delegate,
            ...(knowledge ? [knowledge.tool] : []),
          ],
          settings: input.toolSettings,
          model: target.model,
          context: {
            userId: auth.userId,
            timeZone: input.options.timeZone,
            signal: g.signal,
            http: deps.toolsHttp,
            log: deps.log,
            fetchSlots: createFetchSlots(),
          },
        }),
        ...(afterFinish ? { afterFinish: (final: MessagePublic) => afterFinish(g, final) } : {}),
      },
      deps.runDeps,
    ),
  );
  return { generation, contextTrimmed: turn.contextTrimmed };
}
