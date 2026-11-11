import { defaultSettings, type MessagePublic } from '@neotext/shared';
import { expect, test, vi } from 'vitest';
import type { ResolvedProvider } from '../providers/types';
import { createSearchBudget } from '../search/budget';
import type { ToolDefinition } from '../tools/types';
import type { Generation } from './generation/generation';
import type { RunDeps, RunSpec } from './generation/runner';
import { WEB_SEARCH_GUIDANCE, type WebSearchPlan } from './generation/web-search';
import { startTargetRun, type TargetRunInput } from './target-run';

const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as never;
const message = {
  id: 'msg_a',
  conversationId: 'cnv_1',
  parentId: 'msg_u',
  role: 'assistant',
  status: 'streaming',
  parts: [],
  model: { providerId: 'prv_1', modelId: 'm1' },
  usage: null,
  finishReason: null,
  createdAt: 1,
  updatedAt: 1,
} as MessagePublic;
const echo: ToolDefinition = {
  name: 'echo',
  description: 'Echo.',
  parameters: { type: 'object' },
  source: 'app',
  defaultPolicy: 'auto',
  execute: vi.fn(),
};

/** The tools offered besides the project file tools, which every tool-capable target gets. */
const otherTools = (spec: RunSpec) =>
  (spec.tools?.defs.map((d) => d.name) ?? []).filter(
    (n) => !['write_file', 'edit_file', 'delete_file', 'read_file'].includes(n),
  );

function setup(plan: WebSearchPlan, over: Partial<TargetRunInput> = {}) {
  const specs: RunSpec[] = [];
  let started: Generation | null = null;
  const deps = {
    messages: {} as never,
    manager: {
      start: (g: Generation, run: (g: Generation) => Promise<void>) => {
        started = g;
        void run(g);
      },
    },
    runDeps: {} as RunDeps,
    clock: { now: () => 5 } as never,
    log,
    toolsHttp: {} as never,
    run: async (spec: RunSpec) => {
      specs.push(spec);
    },
  };
  const input: TargetRunInput = {
    auth: { userId: 'usr_1', dek: Buffer.alloc(32) } as never,
    conversationId: 'cnv_1',
    message,
    target: {
      ref: { providerId: 'prv_1', modelId: 'm1' },
      provider: { id: 'prv_1', kind: 'openai-compatible' } as unknown as ResolvedProvider,
      model: null,
    },
    plan,
    path: [],
    chat: { ...defaultSettings().chat, includeDate: false },
    options: { timeZone: 'UTC' } as never,
    toolSettings: defaultSettings().tools,
    available: [echo],
    userText: 'harga btc?',
    endUserId: 'u-hash',
    now: 5,
    searchesPerTask: 3,
    ...over,
  };
  const out = startTargetRun(deps, input);
  return { out, spec: specs[0] as RunSpec, started: () => started };
}

test('a server plan puts the OpenRouter tool into the request and runs the loop with tools', () => {
  const plan: WebSearchPlan = {
    kind: 'server',
    serverTools: [{ type: 'openrouter:web_search', parameters: { engine: 'exa' } }],
    maxServerToolCalls: 2,
    budget: createSearchBudget(2),
  };
  const { out, spec, started } = setup(plan);
  expect(spec.webSearch).toBe(true);
  expect(spec.searchBudget).toBe(plan.budget);
  expect(spec.request.serverTools).toEqual(plan.serverTools);
  expect(otherTools(spec)).toEqual(['echo']);
  expect(spec.preContext).toBeUndefined();
  // Each generation gets its own fetch_url slots.
  expect(spec.toolContext?.fetchSlots).not.toBe(setup(plan).spec.toolContext?.fetchSlots);
  expect(typeof spec.toolContext?.fetchSlots).toBe('function');
  expect(out.generation).toBe(started());
  expect(out.contextTrimmed).toBe(0);
});

test('a tool plan offers its web_search first; a pre-search plan carries the search', () => {
  const tool = { ...echo, name: 'web_search' };
  const budget = createSearchBudget(3);
  const withTool = setup({ kind: 'tool', tool, budget });
  expect(otherTools(withTool.spec)).toEqual(['web_search', 'echo']);
  expect(withTool.spec.searchBudget).toBe(budget);
  expect(withTool.spec.webSearch).toBe(false);

  const run = vi.fn(async () => []);
  const pre = setup({ kind: 'pre-search', run });
  expect(pre.spec.preContext).toEqual({ query: 'harga btc?', run });
  expect(pre.spec.request.serverTools).toBeUndefined();
  expect(pre.spec.searchBudget).toBeUndefined();
});

test('afterFinish is wired to the generation it belongs to', async () => {
  const afterFinish = vi.fn(async () => {});
  const { spec, started } = setup({ kind: 'none' }, { afterFinish });
  await spec.afterFinish?.({} as MessagePublic);
  expect(afterFinish).toHaveBeenCalledWith(started(), {});
});

test('an agent with web search off gets no search on any plan', () => {
  const agent = {
    id: 'agt_1',
    name: 'Offline',
    data: {
      description: '',
      instructions: 'Review.',
      model: null,
      tools: { webSearch: false, fetchUrl: true },
      autoDelegate: false,
      enabled: true,
    },
    position: '0',
    createdAt: 1,
    updatedAt: 1,
  };
  const server: WebSearchPlan = {
    kind: 'server',
    serverTools: [{ type: 'openrouter:web_search', parameters: {} }],
    maxServerToolCalls: 3,
    budget: createSearchBudget(3),
  };
  const tool = { ...echo, name: 'web_search' };
  const toolPlan: WebSearchPlan = { kind: 'tool', tool, budget: createSearchBudget(3) };
  for (const plan of [server, toolPlan]) {
    const { spec } = setup(plan, { agent, available: [echo, tool] });
    expect(spec.request.serverTools).toBeUndefined();
    expect(spec.webSearch).toBe(false);
    expect(spec.searchBudget).toBeUndefined();
    expect(otherTools(spec)).toEqual(['echo']);
    expect(JSON.stringify(spec.request.messages)).not.toContain(WEB_SEARCH_GUIDANCE);
  }
});

function withProject(over: Partial<TargetRunInput> = {}) {
  const write = {
    type: 'tool_call' as const,
    id: 'call_w',
    name: 'write_file',
    source: 'app' as const,
    args: JSON.stringify({ path: 'index.html', content: '<p>a</p>' }),
    status: 'ok' as const,
    result: null,
    startedAt: 0,
    finishedAt: 0,
  };
  const path = [{ ...message, id: 'msg_old', status: 'complete', parts: [write] } as MessagePublic];
  return setup({ kind: 'none' }, { path, ...over });
}

const PROJECT_TOOL_NAMES = ['write_file', 'edit_file', 'delete_file', 'read_file'];

test('the project tools come after the others, bound to the branch files', async () => {
  const { spec } = withProject();
  expect(spec.tools?.defs.map((d) => d.name)).toEqual(['echo', ...PROJECT_TOOL_NAMES]);
  const read = spec.tools?.get('read_file');
  expect(await read?.execute({ path: 'index.html' }, spec.toolContext as never)).toEqual({
    ok: true,
    content: '1| <p>a</p>',
  });
  expect(JSON.stringify(spec.request.messages)).toContain(
    'This chat has a web project (version 1): index.html (0.0 KB).',
  );
});

test('a branch without a project gets the tools but no project line', () => {
  const { spec } = setup({ kind: 'none' });
  expect(spec.tools?.defs.map((d) => d.name)).toEqual(['echo', ...PROJECT_TOOL_NAMES]);
  expect(JSON.stringify(spec.request.messages)).not.toContain('web project');
});

test('a model without tools gets neither the tools nor the project line', () => {
  const { spec } = withProject({
    target: {
      ref: { providerId: 'prv_1', modelId: 'm1' },
      provider: { id: 'prv_1', kind: 'openai-compatible' } as unknown as ResolvedProvider,
      model: { supports: { tools: false }, inputModalities: [], contextLength: null } as never,
    },
  });
  expect(spec.tools).toBeUndefined();
  expect(JSON.stringify(spec.request.messages)).not.toContain('web project');
});

test('turning read_file off drops the project line', () => {
  const tools = defaultSettings().tools;
  const { spec } = withProject({
    toolSettings: { ...tools, policies: { ...tools.policies, read_file: 'off' } },
  });
  expect(spec.tools?.defs.map((d) => d.name)).not.toContain('read_file');
  expect(JSON.stringify(spec.request.messages)).not.toContain('web project');
});
