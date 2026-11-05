import { newId } from '@neotext/shared';
import { eq } from 'drizzle-orm';
import type { DbHandle } from '../db/client';
import { providers, usageEvents } from '../db/schema';
import type { Clock } from '../lib/clock';
import type { Logger } from '../lib/logger';
import type { ProviderUsage } from '../providers/types';
import type { ResolvedBackend } from '../search/resolve';

export interface UsageEventInsert {
  userId: string;
  conversationId: string | null;
  messageId: string | null;
  providerId: string;
  modelId: string;
  /** `search`: one call to a search backend (SearXNG, Brave, Tavily). */
  kind: 'chat' | 'title' | 'tool' | 'search';
  usage: ProviderUsage;
  /** The provider's id for this upstream call (OpenRouter generation id), when known. */
  generationRef?: string | null;
  createdAt: number;
}

export interface UsageRepo {
  insert(e: UsageEventInsert): void;
}

/**
 * `onSharedSpend` hears of every known cost on a shared provider, so the quota cache stays
 * current. Shared-ness is read once, here, and stored on the row (`usage_events.shared`).
 */
export function createUsageRepo(
  db: DbHandle,
  onSharedSpend?: (userId: string, costUsd: number) => void,
): UsageRepo {
  return {
    insert: (e) => {
      const owner = db.orm
        .select({ ownerUserId: providers.ownerUserId })
        .from(providers)
        .where(eq(providers.id, e.providerId))
        .get();
      const shared = owner !== undefined && owner.ownerUserId === null;
      db.orm
        .insert(usageEvents)
        .values({
          id: newId('use'),
          userId: e.userId,
          conversationId: e.conversationId,
          messageId: e.messageId,
          providerId: e.providerId,
          modelId: e.modelId,
          kind: e.kind,
          promptTokens: e.usage.promptTokens,
          completionTokens: e.usage.completionTokens,
          reasoningTokens: e.usage.reasoningTokens,
          cachedTokens: e.usage.cachedTokens,
          costUsd: e.usage.costUsd,
          webSearchRequests: e.usage.webSearchRequests,
          generationRef: e.generationRef ?? null,
          shared,
          createdAt: e.createdAt,
        })
        .run();
      if (shared && e.usage.costUsd !== null) onSharedSpend?.(e.userId, e.usage.costUsd);
    },
  };
}

/**
 * Records one search backend call (SearXNG, Brave, Tavily) of an answer: no tokens, cost
 * unknown, the backend kind as the model. A failed write is only logged.
 */
export function searchUsageRecorder(
  repo: UsageRepo,
  ctx: { userId: string; conversationId: string; clock: Clock; log: Logger },
): (backend: ResolvedBackend, messageId: string) => void {
  return ({ backend, provider }, messageId) => {
    try {
      repo.insert({
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        messageId,
        providerId: provider.id,
        modelId: backend.kind,
        kind: 'search',
        usage: { ...NO_TOKENS, costUsd: null, webSearchRequests: 1 },
        createdAt: ctx.clock.now(),
      });
    } catch (err) {
      ctx.log.error({ err, conversationId: ctx.conversationId }, 'search usage record failed');
    }
  };
}

const NO_TOKENS = { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cachedTokens: 0 };
