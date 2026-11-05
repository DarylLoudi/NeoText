import {
  type ChatRequestBody,
  type MessagePublic,
  type ModelRef,
  newId,
  pathToLeaf,
} from '@neotext/shared';
import type { AttachmentsService } from '../attachments/service';
import type { DbHandle } from '../db/client';
import type { AuthContext } from '../http/env';
import { AppError } from '../http/errors';
import { type RateLimiter, rateLimited } from '../http/rate-limit';
import type { Clock } from '../lib/clock';
import type { Logger } from '../lib/logger';
import type { HttpClient } from '../net/http-client';
import { applyPreset, type PresetsService } from '../presets/service';
import { getAdapter } from '../providers/registry';
import type { ProviderService } from '../providers/service';
import type { QuotaService } from '../quotas/service';
import type { SettingsService } from '../settings/service';
import type { ToolCatalog } from '../tools/registry';
import { assertBudget } from '../usage/budget';
import { searchUsageRecorder, type UsageRepo } from '../usage/repo';
import type { ConversationsRepo } from './conversations-repo';
import type { Generation } from './generation/generation';
import type { GenerationManager } from './generation/manager';
import type { RunDeps } from './generation/runner';
import { webSearchPlanner } from './generation/web-search';
import type { MessagesRepo } from './messages-repo';
import { startTargetRun } from './target-run';
import { fallbackTitle, generateTitle, TITLE_TIMEOUT_MS } from './title';
import { checkParent, loadHistory, resolvePreset } from './turn-history';
import { prepareFiles, reuse } from './turn-prepare';
import { assertSharedQuota } from './turn-quota';
import { endUserIdFor } from './turn-request';
import { anyTargetMayUseTools, turnText } from './turn-tools';

export interface StartedTurn {
  conversationId: string;
  generations: Generation[];
  userMessage: MessagePublic | null;
  contextTrimmed: number;
  reused: boolean;
}

export interface ChatService {
  startTurn(
    auth: AuthContext,
    body: ChatRequestBody,
    idempotencyKey: string | null,
  ): Promise<StartedTurn>;
}

export interface ChatServiceDeps {
  db: DbHandle;
  settings: SettingsService;
  providers: ProviderService;
  quotas: QuotaService;
  conversations: ConversationsRepo;
  presets: PresetsService;
  /** Links uploads to the user message and opens them for the model. */
  attachments: Pick<AttachmentsService, 'attach' | 'prepareReuse' | 'loadForTurn' | 'discard'>;
  messages: MessagesRepo;
  usage: UsageRepo;
  generations: GenerationManager;
  tools: ToolCatalog;
  /** Client for app tools that reach the web; private networks refused. */
  toolsHttp: HttpClient;
  limiter: RateLimiter;
  clock: Clock;
  log: Logger;
}

const textOfMessage = (m: MessagePublic) =>
  m.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('');

export function createChatService(deps: ChatServiceDeps): ChatService {
  const { db, settings, providers, conversations, messages, clock, log } = deps;
  const manager = deps.generations;
  const runDeps: RunDeps = {
    clock,
    log,
    usage: deps.usage,
    conversationsTouch: (id, at) => conversations.touch(id, at),
  };
  const historyDeps = { db, conversations, presets: deps.presets, messages };
  const prepareDeps = { messages, generations: manager, attachments: deps.attachments };
  const targetRunDeps = {
    messages,
    manager,
    runDeps,
    clock,
    log,
    toolsHttp: deps.toolsHttp,
  };

  /**
   * Names the conversation after its first finished exchange. Runs before the stream closes,
   * so it must stop writing once the generation was aborted for shutdown.
   */
  async function autoTitle(
    auth: AuthContext,
    generation: Generation,
    ref: ModelRef,
    userText: string,
    final: MessagePublic,
  ): Promise<void> {
    const { conversationId } = generation;
    const stopped = () => generation.abortReason() === 'shutdown';
    if (final.status !== 'complete' || stopped()) return;
    const current = conversations.get(auth.userId, conversationId, auth.dek);
    if (current?.titleSource !== 'none') return;
    const picked = settings.get(auth.userId, auth.dek).settings.chat.titleModel;
    // A title model on a turned-off provider gives way to the model that just answered, and so
    // does one on a shared provider once the member's shared quota is used up: the turn's own
    // check only covered the turn's targets.
    const configured =
      picked &&
      providers.isEnabled(auth, picked.providerId) &&
      !providers.isSearchBackend(auth, picked.providerId) &&
      !(providers.isShared(auth, picked.providerId) && deps.quotas.status(auth.userId).exhausted)
        ? picked
        : ref;
    let title: string | null = null;
    try {
      const provider = providers.resolve(auth, configured.providerId);
      const model = providers.cachedModel(configured.providerId, configured.modelId);
      const result = await generateTitle({
        adapter: getAdapter(provider.kind),
        provider,
        model: configured.modelId,
        reasoningSupported: model?.reasoning != null,
        userText,
        assistantText: textOfMessage(final),
        signal: AbortSignal.any([AbortSignal.timeout(TITLE_TIMEOUT_MS), generation.signal]),
      });
      title = result.title;
      if (result.usage && !stopped()) {
        deps.usage.insert({
          userId: auth.userId,
          conversationId,
          messageId: final.id,
          providerId: configured.providerId,
          modelId: configured.modelId,
          kind: 'title',
          usage: result.usage,
          createdAt: clock.now(),
        });
      }
    } catch (err) {
      log.warn({ err, conversationId }, 'title generation failed');
    }
    if (stopped()) return;
    const finalTitle = title ?? fallbackTitle(userText);
    if (finalTitle === '') return;
    conversations.update(
      auth.userId,
      conversationId,
      { title: finalTitle, titleSource: 'auto' },
      clock.now(),
      auth.dek,
    );
    generation.emit({ type: 'conversation.updated', conversationId, title: finalTitle });
  }

  return {
    startTurn: async (auth, body, idempotencyKey) => {
      const hit = deps.limiter.hit(`chat:${auth.userId}`);
      if (!hit.allowed) throw rateLimited(hit.retryAfterMs);
      // Before any MCP work. A retry of a turn already accepted is reused below, never refused.
      if (idempotencyKey === null || !manager.lookupIdempotency(auth.userId, idempotencyKey)) {
        const { budget } = settings.get(auth.userId, auth.dek).settings;
        assertBudget(db, auth.userId, budget, clock.now(), body.options.timeZone);
        assertSharedQuota({ providers, quotas: deps.quotas }, auth, body.targets);
      }
      // The only waits: MCP tool lists, and the turn's files. Everything after them is
      // synchronous SQLite work, so two requests never interleave between the idempotency check
      // and the inserts.
      const userText = turnText(auth, body, messages);
      // A retry whose first attempt already started must not copy or open any file. The check
      // runs again after the waits, for a duplicate that arrives during them.
      if (idempotencyKey !== null) {
        const early = reuse(prepareDeps, auth, idempotencyKey);
        if (early) return early;
      }
      const [tools, prepared] = await Promise.allSettled([
        anyTargetMayUseTools(auth, body.targets, providers)
          ? deps.tools.forTurn(auth, { userText, webSearch: body.options.webSearch })
          : Promise.resolve([]),
        prepareFiles(prepareDeps, auth, body),
      ]);
      if (prepared.status === 'rejected') throw prepared.reason;
      const files = prepared.value;
      /** Set once the transaction links the copies; until then a failure discards them. */
      let linked = false;
      try {
        if (tools.status === 'rejected') throw tools.reason;
        const available = tools.value;
        if (idempotencyKey !== null) {
          const reused = reuse(prepareDeps, auth, idempotencyKey);
          if (reused) return reused;
        }
        const userSettings = settings.get(auth.userId, auth.dek).settings;
        const history = loadHistory(historyDeps, auth, body);
        const preset = resolvePreset(historyDeps, auth, body);
        const { chat, options } = applyPreset(
          userSettings.chat,
          body.options,
          preset?.data ?? null,
        );
        checkParent(body, history);
        manager.assertCapacity(auth.userId, body.targets.length);
        if (body.targets.some((ref) => providers.isSearchBackend(auth, ref.providerId))) {
          throw new AppError('bad_request', 'That provider is for web search, not chat.', 400);
        }
        const targets = body.targets.map((ref) => ({
          ref,
          provider: providers.resolveEnabled(auth, ref.providerId),
          model: providers.cachedModel(ref.providerId, ref.modelId),
        }));

        // One `now` for every row: later plans find compare groups by equal `createdAt`.
        const now = clock.now();
        const conversationId = body.conversationId ?? newId('cnv');
        const base = { conversationId, usage: null, finishReason: null, createdAt: now };
        const userMessage: MessagePublic | null = body.userMessage
          ? {
              ...base,
              id: newId('msg'),
              parentId: body.parentId,
              role: 'user',
              status: 'complete',
              parts:
                body.userMessage.text === '' ? [] : [{ type: 'text', text: body.userMessage.text }],
              model: null,
              updatedAt: now,
            }
          : null;
        const answersId = userMessage?.id ?? (body.parentId as string);
        const assistants: MessagePublic[] = targets.map((t) => ({
          ...base,
          id: newId('msg'),
          parentId: answersId,
          role: 'assistant',
          status: 'streaming',
          parts: [],
          model: t.ref,
          updatedAt: now,
        }));
        const firstAssistant = assistants[0] as MessagePublic;

        db.raw.transaction(() => {
          if (body.conversationId === null) {
            conversations.insert(
              {
                id: conversationId,
                userId: auth.userId,
                folderId: options.folderId,
                presetId: preset?.id ?? null,
                title: null,
                createdAt: now,
              },
              auth.dek,
            );
          }
          if (userMessage && files.uploadIds.length > 0) {
            // 400 (and a rollback) unless each upload is the user's and not sent before.
            userMessage.parts.push(
              ...deps.attachments.attach(auth, files.uploadIds, conversationId, userMessage.id),
            );
          }
          // An edit keeps the names of files that vanished, as unavailable parts.
          if (userMessage) userMessage.parts.push(...files.unavailable);
          for (const m of userMessage ? [userMessage, ...assistants] : assistants) {
            messages.insert(
              {
                id: m.id,
                conversationId,
                userId: auth.userId,
                parentId: m.parentId,
                role: m.role,
                status: m.status,
                parts: m.parts,
                providerId: m.model?.providerId ?? null,
                modelId: m.model?.modelId ?? null,
                createdAt: now,
              },
              auth.dek,
            );
          }
          const added = assistants.length + (userMessage ? 1 : 0);
          const modelRef = firstAssistant.model as ModelRef;
          conversations.recordTurn(conversationId, now, firstAssistant.id, added, modelRef);
        })();
        linked = true;

        const planFor = webSearchPlanner(
          auth,
          providers,
          userSettings.webSearch,
          options.webSearch,
          searchUsageRecorder(deps.usage, { userId: auth.userId, conversationId, clock, log }),
        );
        const path = pathToLeaf(userMessage ? [...history, userMessage] : history, answersId);
        const endUserId = endUserIdFor(auth.userId);
        // Lookups only: every file was opened before the synchronous part, once per turn.
        const loadAttachment = (id: string) => files.loaded.get(id) ?? null;
        let contextTrimmed = 0;
        const generations = targets.map((t, i) => {
          const message = assistants[i] as MessagePublic;
          const plan = planFor(t.provider, t.model, message.id);
          const run = startTargetRun(targetRunDeps, {
            auth,
            conversationId,
            message,
            target: t,
            plan,
            path,
            loadAttachment,
            chat,
            options,
            toolSettings: userSettings.tools,
            available,
            userText,
            endUserId,
            now,
            ...(i === 0 && userMessage && chat.autoTitle
              ? {
                  afterFinish: (g: Generation, final: MessagePublic) =>
                    autoTitle(auth, g, t.ref, userText, final),
                }
              : {}),
          });
          contextTrimmed = Math.max(contextTrimmed, run.contextTrimmed);
          return run.generation;
        });
        if (idempotencyKey !== null) {
          manager.rememberIdempotency(
            auth.userId,
            idempotencyKey,
            generations.map((g) => g.id),
          );
        }
        return { conversationId, generations, userMessage, contextTrimmed, reused: false };
      } finally {
        if (!linked && files.copied.length > 0) deps.attachments.discard(auth, files.copied);
      }
    },
  };
}
