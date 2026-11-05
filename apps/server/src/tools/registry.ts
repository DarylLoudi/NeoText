import type { AuthContext } from '../http/env';
import type { Logger } from '../lib/logger';
import type { ToolDefinition, ToolPolicy, ToolSet } from './types';

/** User policy, else the tool's default. `off` tools are left out of `defs` and `get`. */
export function assembleToolSet(
  tools: ToolDefinition[],
  policies: Record<string, ToolPolicy>,
): ToolSet {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const policy = (name: string): ToolPolicy =>
    policies[name] ?? byName.get(name)?.defaultPolicy ?? 'off';
  const offered = tools.filter((t) => policy(t.name) !== 'off');
  return {
    defs: offered.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
    get: (name) => (policy(name) === 'off' ? undefined : byName.get(name)),
    policy,
  };
}

/** What a turn is about, for sources that offer some tools only when they apply. */
export interface ToolTurn {
  userText: string;
  webSearch: boolean;
}

/**
 * Contributes tools for a turn, or every tool the user could get when `turn` is null
 * (the settings listing).
 */
export type ToolSource = (
  auth: AuthContext,
  turn: ToolTurn | null,
) => ToolDefinition[] | Promise<ToolDefinition[]>;

export interface ToolCatalog {
  add(source: ToolSource): void;
  forTurn(auth: AuthContext, turn: ToolTurn): Promise<ToolDefinition[]>;
  list(auth: AuthContext): Promise<ToolDefinition[]>;
}

/** How long a turn waits for one source's tool list (a cold MCP list) before skipping it. */
export const TOOL_SOURCE_WAIT_MS = 2_000;

/** Resolves the source's list, or null when it is not ready within the deadline. */
async function withDeadline(
  list: ToolDefinition[] | Promise<ToolDefinition[]>,
): Promise<ToolDefinition[] | null> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), TOOL_SOURCE_WAIT_MS);
    timer.unref?.();
  });
  try {
    return await Promise.race([Promise.resolve(list), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tool sources in order; the first name wins. A source that fails, or misses the
 * `TOOL_SOURCE_WAIT_MS` deadline, is logged (without turn content) and skipped this time.
 */
export function createToolCatalog(deps: { log: Logger }): ToolCatalog {
  const sources: ToolSource[] = [];

  const collect = async (auth: AuthContext, turn: ToolTurn | null) => {
    const lists = await Promise.all(
      sources.map(async (source, index) => {
        try {
          const list = await withDeadline(source(auth, turn));
          if (list) return list;
          deps.log.warn({ source: index }, 'a tool source was too slow; its tools are skipped');
        } catch (err) {
          deps.log.warn(
            { source: index, err: err instanceof Error ? err.name : 'unknown' },
            'a tool source failed; its tools are skipped',
          );
        }
        return [];
      }),
    );
    const byName = new Map<string, ToolDefinition>();
    for (const t of lists.flat()) if (!byName.has(t.name)) byName.set(t.name, t);
    return [...byName.values()];
  };

  return {
    add: (source) => {
      sources.push(source);
    },
    forTurn: (auth, turn) => collect(auth, turn),
    list: (auth) => collect(auth, null),
  };
}
