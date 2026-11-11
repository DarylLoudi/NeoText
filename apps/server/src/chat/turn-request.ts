import { createHash } from 'node:crypto';
import type {
  ChatRequestBody,
  MessagePublic,
  ModelInfo,
  ReasoningEffort,
  UserSettings,
} from '@neotext/shared';
import type { AttachmentLookup } from '../attachments/model-file';
import type { ChatRequest } from '../providers/types';
import { DELEGATE_GUIDANCE } from '../tools/builtin/delegate';
import { buildContext, modelInputFor } from './context';
import { WEB_SEARCH_GUIDANCE, type WebSearchPlan } from './generation/web-search';

/** A stable per-user id for providers' abuse tracking; never the raw user id. */
export function endUserIdFor(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, 16);
}

/** The requested effort, else the setting; omitted for `auto` or an effort the model lacks. */
export function resolveReasoningEffort(
  requested: ReasoningEffort | null,
  setting: ReasoningEffort | 'auto',
  model: ModelInfo | null,
): ReasoningEffort | null {
  const effort = requested ?? (setting === 'auto' ? null : setting);
  if (effort === null) return null;
  const known = model?.reasoning?.efforts ?? [];
  return known.length > 0 && !known.includes(effort) ? null : effort;
}

export interface TurnRequestInput {
  path: MessagePublic[];
  chat: UserSettings['chat'];
  options: ChatRequestBody['options'];
  modelId: string;
  model: ModelInfo | null;
  /** How this target searches the web; only a `server` plan adds to the request. */
  plan: WebSearchPlan;
  endUserId: string;
  now: number;
  loadAttachment?: AttachmentLookup;
  /** Replaces the user's default system prompt (a custom agent's instructions). */
  systemPrompt?: string;
  /** True when this target is offered `delegate_tasks`: adds `DELEGATE_GUIDANCE`. */
  delegation?: boolean;
  /** The system line of an agent offered `search_knowledge` (`knowledgeGuidance`). */
  knowledgeGuidance?: string;
  /** The system line of a branch with a web project (`projectGuidance`). */
  projectGuidance?: string;
}

export interface TurnRequest {
  request: ChatRequest;
  /** True when this request carries the provider's server-side web search. */
  webSearch: boolean;
  /** Messages dropped from the front of the history to fit the context window. */
  contextTrimmed: number;
}

/** Builds the provider request for one target of a turn. No clock; I/O only via `loadAttachment`. */
export function buildTurnRequest(input: TurnRequestInput): TurnRequest {
  const { chat, options, model } = input;
  const temperature = options.temperature ?? chat.temperature;
  const maxTokens = options.maxOutputTokens ?? chat.maxOutputTokens;
  const { plan } = input;
  const extraSystem = [
    plan.kind === 'server' || plan.kind === 'tool' ? WEB_SEARCH_GUIDANCE : '',
    input.delegation ? DELEGATE_GUIDANCE : '',
    input.knowledgeGuidance ?? '',
    input.projectGuidance ?? '',
  ]
    .filter((s) => s !== '')
    .join('\n\n');
  const context = buildContext({
    path: input.path,
    systemPrompt: input.systemPrompt ?? chat.defaultSystemPrompt,
    ...(extraSystem !== '' ? { extraSystem } : {}),
    includeDate: chat.includeDate,
    timeZone: options.timeZone,
    now: input.now,
    contextLength: model?.contextLength ?? null,
    maxOutputTokens: maxTokens,
    strategy: chat.contextStrategy,
    ...(input.loadAttachment ? { loadAttachment: input.loadAttachment } : {}),
    modelInput: modelInputFor(model),
  });
  const effort = resolveReasoningEffort(options.reasoningEffort, chat.reasoningEffort, model);
  const webSearch = plan.kind === 'server';
  const request: ChatRequest = {
    model: input.modelId,
    messages: context.messages,
    endUserId: input.endUserId,
    ...(effort !== null ? { reasoning: { effort } } : {}),
    ...(temperature !== null ? { temperature } : {}),
    ...(maxTokens !== null ? { maxTokens } : {}),
    ...(plan.kind === 'server'
      ? { serverTools: plan.serverTools, maxServerToolCalls: plan.maxServerToolCalls }
      : {}),
  };
  return { request, webSearch, contextTrimmed: context.trimmed };
}
