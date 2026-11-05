import { defaultSettings, type ModelInfo, type UserSettings } from '@neotext/shared';
import { expect, test, vi } from 'vitest';
import type { AuthContext } from '../http/env';
import { AppError } from '../http/errors';
import { createFakeClock } from '../lib/clock';
import type { ResolvedProvider } from '../providers/types';
import { createSearchBudget, type SearchBudget } from '../search/budget';
import { DELEGATE_TOOL, delegationSearch } from '../tools/builtin/delegate';
import type { ToolDefinition } from '../tools/types';
import type { UsageEventInsert } from '../usage/repo';
import { openRouterWebSearch, type WebSearchPlan } from './generation/web-search';
import { type DelegationDeps, delegateDepsFor, offersDelegation } from './turn-delegate';

const auth = { userId: 'usr_1', dek: Buffer.alloc(32) } as unknown as AuthContext;
const provider = (id: string, kind: ResolvedProvider['kind']) =>
  ({ id, kind }) as unknown as ResolvedProvider;
const withTools = (tools: boolean | null) => ({ supports: { tools } }) as unknown as ModelInfo;
const settings = (over: Partial<UserSettings['tools']> = {}): UserSettings['tools'] => ({
  ...defaultSettings().tools,
  ...over,
});
/** A backend `web_search` that remembers the budget it was made with. */
const searchTool = (budget: SearchBudget) =>
  ({ name: 'web_search', defaultPolicy: 'auto', budget }) as unknown as ToolDefinition;
const mainBudget = createSearchBudget(3);
const toolPlan: WebSearchPlan = {
  kind: 'tool',
  tool: searchTool(mainBudget),
  budget: mainBudget,
  searchTool,
};
const serverPlan: WebSearchPlan = {
  kind: 'server',
  ...openRouterWebSearch(),
  budget: createSearchBudget(3),
};
const search = () => delegationSearch(3, 2);
const all = { webSearch: true, fetchUrl: true };

function setup(
  opts: {
    tools?: UserSettings['tools'];
    plan?: WebSearchPlan;
    noTools?: string[];
    shared?: string[];
    exhausted?: boolean;
  } = {},
) {
  const rows: UsageEventInsert[] = [];
  const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
  const deps: DelegationDeps = {
    agents: { list: () => [] },
    providers: {
      isSearchBackend: (_a, id) => id === 'prv_search',
      isShared: (_a, id) => opts.shared?.includes(id) ?? false,
      resolveEnabled: (_a, id) => {
        if (id === 'prv_gone') throw new Error('not found');
        return provider(id, id === 'prv_or' ? 'openrouter' : 'openai-compatible');
      },
      cachedModel: (_p, modelId) => withTools(opts.noTools?.includes(modelId) ? false : null),
    },
    quotas: {
      assertWithin: () => {
        if (opts.exhausted) throw new AppError('quota_exceeded', 'used up', 402);
      },
    },
    usage: { insert: (row) => rows.push(row) },
    clock: createFakeClock(),
    log: log as never,
  };
  const built = delegateDepsFor(deps, {
    auth,
    conversationId: 'cnv_1',
    messageId: 'msg_1',
    target: {
      ref: { providerId: 'prv_main', modelId: 'm/main' },
      provider: provider('prv_main', 'openrouter'),
    },
    plan: opts.plan ?? toolPlan,
    toolSettings: opts.tools ?? settings(),
    searchesPerTask: 3,
    endUserId: 'end',
  });
  return { built, rows, log };
}

test('delegation is offered only to a model that may use tools, unless turned off', () => {
  const on = settings();
  expect(offersDelegation({ model: null, toolSettings: on })).toBe(true);
  expect(offersDelegation({ model: withTools(true), toolSettings: on })).toBe(true);
  expect(offersDelegation({ model: withTools(false), toolSettings: on })).toBe(false);
  const off = settings({ policies: { [DELEGATE_TOOL]: 'off' } });
  expect(offersDelegation({ model: null, toolSettings: off })).toBe(false);
});

test('the sub-agent model is the setting when it resolves, else the main model', () => {
  const picked = { providerId: 'prv_other', modelId: 'm/cheap' };
  expect(setup({ tools: settings({ subagentModel: picked }) }).built.model(null)).toMatchObject(
    picked,
  );
  expect(setup().built.model(null)).toMatchObject({ providerId: 'prv_main', modelId: 'm/main' });
  for (const broken of ['prv_gone', 'prv_search']) {
    const s = setup({ tools: settings({ subagentModel: { providerId: broken, modelId: 'x' } }) });
    expect(s.built.model(null)).toMatchObject({ providerId: 'prv_main' });
    expect(s.log.warn).toHaveBeenCalled();
  }
  // An agent's own model comes first.
  const own = { providerId: 'prv_own', modelId: 'm/own' };
  expect(setup({ tools: settings({ subagentModel: picked }) }).built.model(own)).toMatchObject(own);
});

test('a shared model over the quota gives way to the main model, or to none', () => {
  const picked = { providerId: 'prv_shared', modelId: 'm/admin' };
  const over = setup({
    tools: settings({ subagentModel: picked }),
    shared: ['prv_shared'],
    exhausted: true,
  });
  expect(over.built.model(null)).toMatchObject({ providerId: 'prv_main' });
  expect(over.built.model(picked)).toMatchObject({ providerId: 'prv_main' });
  // Within the quota the shared model runs.
  const within = setup({ tools: settings({ subagentModel: picked }), shared: ['prv_shared'] });
  expect(within.built.model(null)).toMatchObject(picked);
  // The main model is shared too: no model may run the task.
  const none = setup({ shared: ['prv_main'], exhausted: true });
  expect(none.built.model(null)).toBeNull();
});

test('sub-agents get the plan web_search and fetch_url, never delegate_tasks', () => {
  const { built } = setup();
  const model = built.model(null);
  if (!model) throw new Error('no model');
  expect(built.tools(model, all, search()).tools.map((t) => t.name)).toEqual([
    'web_search',
    'fetch_url',
  ]);
  expect(
    built.tools(model, { webSearch: false, fetchUrl: true }, search()).tools.map((t) => t.name),
  ).toEqual(['fetch_url']);
});

test("under a tool plan, sub-agents search on the delegation's budget, not the answer's", () => {
  const { built } = setup();
  const model = built.model(null);
  if (!model) throw new Error('no model');
  const shared = search();
  const tool = built.tools(model, all, shared).tools[0] as unknown as { budget: SearchBudget };
  expect(tool.budget).toBe(shared.budget);
  expect(tool.budget).not.toBe(mainBudget);
  expect(shared.budget.remaining()).toBe(6);
});

test('OpenRouter native search goes to an OpenRouter sub-agent with its share', () => {
  const { built } = setup({ plan: serverPlan });
  const or = built.model(null);
  if (!or) throw new Error('no model');
  const shared = search();
  expect(built.tools(or, { webSearch: true, fetchUrl: false }, shared)).toMatchObject({
    tools: [],
    serverTools: openRouterWebSearch().serverTools,
    maxServerToolCalls: 3,
    searchBudget: shared.budget,
  });
});

test('a non-OpenRouter sub-agent under a server plan gets the backend tool, when there is one', () => {
  const pick = settings({ subagentModel: { providerId: 'prv_x', modelId: 'm' } });
  const bare = setup({ plan: serverPlan, tools: pick }).built;
  const bareModel = bare.model(null);
  if (!bareModel) throw new Error('no model');
  expect(bare.tools(bareModel, { webSearch: true, fetchUrl: false }, search())).toEqual({
    tools: [],
  });
  const withBackend = setup({ plan: { ...serverPlan, searchTool }, tools: pick }).built;
  const model = withBackend.model(null);
  if (!model) throw new Error('no model');
  const out = withBackend.tools(model, { webSearch: true, fetchUrl: false }, search());
  expect(out.serverTools).toBeUndefined();
  expect(out.tools.map((t) => t.name)).toEqual(['web_search']);
});

test('the delegation budget is the per-turn limit per task, at most 12', () => {
  expect(delegationSearch(3, 2)).toMatchObject({ share: 3 });
  expect(delegationSearch(3, 2).budget.remaining()).toBe(6);
  const big = delegationSearch(10, 6);
  expect(big.budget.remaining()).toBe(12);
  expect(big.share).toBe(2);
  expect(delegationSearch(3, 6).share).toBe(2);
});

test('tools that need approval, and models without tools, give sub-agents nothing', () => {
  const ask = setup({ tools: settings({ policies: { fetch_url: 'ask', web_search: 'ask' } }) });
  const askModel = ask.built.model(null);
  if (!askModel) throw new Error('no model');
  expect(ask.built.tools(askModel, all, search()).tools).toEqual([]);
  const none = setup({ noTools: ['m/main'] });
  const noneModel = none.built.model(null);
  if (!noneModel) throw new Error('no model');
  expect(none.built.tools(noneModel, all, search()).tools).toEqual([]);
});

test("usage rows are kind 'tool' on the assistant message", () => {
  const { built, rows } = setup();
  const usage = {
    promptTokens: 1,
    completionTokens: 2,
    reasoningTokens: 0,
    cachedTokens: 0,
    costUsd: 0.1,
    webSearchRequests: 0,
  };
  built.recordUsage({ providerId: 'prv_x', modelId: 'm/x', usage });
  expect(rows).toEqual([
    {
      userId: 'usr_1',
      conversationId: 'cnv_1',
      messageId: 'msg_1',
      providerId: 'prv_x',
      modelId: 'm/x',
      kind: 'tool',
      usage,
      createdAt: expect.any(Number),
    },
  ]);
});
