import type { ProviderService } from '../../providers/service';
import type { ResolvedProvider } from '../../providers/types';
import type { SearchBudget } from '../../search/budget';
import { resolveSearchBackend } from '../../search/resolve';
import { type SearchBackend, SearchError } from '../../search/types';
import type { SettingsService } from '../../settings/service';
import type { ToolSource } from '../registry';
import type { ToolContext, ToolDefinition, ToolResult } from '../types';

export const WEB_SEARCH_TOOL = 'web_search';
export const SEARCH_LIMIT_REACHED =
  'The search limit for this message is reached. Answer from what you have.';

const fail = (error: string): ToolResult => ({ ok: false, error });
const unavailable = (reason: string) =>
  fail(`Search is unavailable right now (${reason}). Answer from what you know and say so.`);

function reasonFor(err: unknown): string {
  if (err instanceof SearchError) {
    if (err.status === 429) return 'rate limited';
    if (err.status === 401 || err.status === 403) return 'the search key was refused';
    if (err.status !== null) return 'the search service had an error';
    return 'the search service sent an unusable answer';
  }
  return 'the search service could not be reached';
}

/**
 * One tool bound to a search backend and the user's provider; results are plain text. With a
 * budget, each search takes one from it and a search past the turn's limit is refused.
 */
export function createWebSearchTool(
  backend: SearchBackend,
  provider: ResolvedProvider,
  count: number,
  budget?: SearchBudget,
): ToolDefinition {
  return {
    name: WEB_SEARCH_TOOL,
    description: 'Search the web for current information. Use short keyword queries.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Short keyword query.' } },
      required: ['query'],
      additionalProperties: false,
    },
    source: 'app',
    defaultPolicy: 'auto',
    async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
      const query = (args as { query?: unknown } | null)?.query;
      if (typeof query !== 'string' || query.trim() === '') {
        return fail('Give the search words as "query".');
      }
      if (budget && !budget.take()) return fail(SEARCH_LIMIT_REACHED);
      try {
        const results = await backend.search(provider, query.trim(), {
          count,
          signal: ctx.signal,
        });
        if (results.length === 0) return { ok: true, content: 'No results found.', sources: [] };
        return {
          ok: true,
          content: results
            .map((r, i) => `[${i + 1}] ${r.title} — ${r.url}\n${r.snippet}`)
            .join('\n\n'),
          sources: results.map((r) => ({ url: r.url, title: r.title, content: r.snippet })),
        };
      } catch (err) {
        if (ctx.signal.aborted) return fail('This request was stopped.');
        ctx.log.info({ err: err instanceof Error ? err.name : 'unknown' }, 'web_search failed');
        return unavailable(reasonFor(err));
      }
    },
  };
}

/**
 * Lists `web_search` in settings when the user picked an enabled search backend. A turn gets
 * it from its web search plan instead (`planWebSearch`), so each target uses one strategy.
 */
export function createWebSearchSource(deps: {
  settings: SettingsService;
  providers: ProviderService;
}): ToolSource {
  return (auth, turn) => {
    if (turn !== null) return [];
    try {
      const { backendProviderId, maxResults } = deps.settings.get(auth.userId, auth.dek).settings
        .webSearch;
      const found = resolveSearchBackend(auth, deps.providers, backendProviderId);
      return found ? [createWebSearchTool(found.backend, found.provider, maxResults)] : [];
    } catch {
      return [];
    }
  };
}
