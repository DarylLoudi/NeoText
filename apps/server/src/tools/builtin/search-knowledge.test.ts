import { type AgentPublic, defaultSettings, type MessagePublic } from '@neotext/shared';
import { expect, test, vi } from 'vitest';
import { log, stop, text } from '../../../test-support/tool-harness';
import type { KnowledgeHit } from '../../agents/knowledge/service';
import type { SubagentInput } from '../../agents/subagent';
import type { RunDeps, RunSpec } from '../../chat/generation/runner';
import { startTargetRun } from '../../chat/target-run';
import { delegateDepsFor } from '../../chat/turn-delegate';
import type { KnowledgeLookup } from '../../chat/turn-tools';
import { createFakeClock } from '../../lib/clock';
import { createSemaphore } from '../../lib/semaphore';
import type { ProviderAdapter, ResolvedProvider } from '../../providers/types';
import type { ToolContext } from '../types';
import { createDelegateTool, GENERIC_SUBAGENT_PROMPT } from './delegate';
import {
  createSearchKnowledgeTool,
  KNOWLEDGE_TOOL,
  knowledgeGuidance,
  knowledgeListingSource,
  NO_KNOWLEDGE_HITS,
} from './search-knowledge';

const ctx: ToolContext = {
  userId: 'usr_1',
  timeZone: 'UTC',
  signal: new AbortController().signal,
  http: {} as never,
  log,
  fetchSlots: createSemaphore(2),
};
const agent = (id: string, over: Partial<AgentPublic['data']> = {}): AgentPublic => ({
  id,
  name: id,
  data: {
    description: '',
    instructions: `You are ${id}.`,
    model: null,
    tools: { webSearch: false, fetchUrl: false },
    autoDelegate: true,
    enabled: true,
    ...over,
  },
  position: '0',
  createdAt: 1,
  updatedAt: 1,
});
const hits: KnowledgeHit[] = [
  { file: 'kalkulus.pdf', page: 3, text: 'Aturan rantai: (f∘g)′ = f′(g)·g′.' },
  { file: 'notes.md', page: null, text: 'Chain rule example.' },
];
/** Agent `agt_kb` has two ready files; every other agent has none. */
const knowledge = (): KnowledgeLookup & { search: ReturnType<typeof vi.fn> } => ({
  hasReady: (_auth, id) => id === 'agt_kb',
  fileNames: (_auth, id) => (id === 'agt_kb' ? ['kalkulus.pdf', 'notes.md'] : []),
  search: vi.fn(() => hits),
});

test('the tool returns numbered blocks citing file and page, or says nothing matched', async () => {
  const search = vi.fn((_q: string) => hits);
  const tool = createSearchKnowledgeTool(search);
  expect(tool).toMatchObject({ name: KNOWLEDGE_TOOL, source: 'app', defaultPolicy: 'auto' });
  expect(await tool.execute({ query: ' aturan rantai ' }, ctx)).toEqual({
    ok: true,
    content:
      '[1] kalkulus.pdf, p. 3\nAturan rantai: (f∘g)′ = f′(g)·g′.\n\n[2] notes.md\nChain rule example.',
  });
  expect(search).toHaveBeenCalledWith('aturan rantai');
  const empty = createSearchKnowledgeTool(() => []);
  expect(await empty.execute({ query: 'x' }, ctx)).toEqual({
    ok: true,
    content: NO_KNOWLEDGE_HITS,
  });
  expect((await empty.execute({ query: '' }, ctx)).ok).toBe(false);
  expect((await empty.execute({}, ctx)).ok).toBe(false);
});

test('the cited blocks stay within 8,000 characters for a full result', async () => {
  const long = Array.from({ length: 6 }, (_, i) => ({
    file: `file-${i}.pdf`,
    page: 100 + i,
    text: 'x'.repeat(Math.floor(8_000 / 6) - 40),
  }));
  const result = await createSearchKnowledgeTool(() => long).execute({ query: 'x' }, ctx);
  expect(result.ok && result.content.length).toBeLessThanOrEqual(8_000);
});

test('the guidance names the files and how to cite them; the listing is settings-only', async () => {
  const line = knowledgeGuidance(['a.pdf', 'b.docx']);
  expect(line).toContain('a.pdf; b.docx');
  expect(line).toContain('search_knowledge');
  expect(line).toContain('[file name, p. N]');
  expect(knowledgeGuidance(Array.from({ length: 25 }, (_, i) => `f${i}`))).toContain('and 5 more');
  expect((await knowledgeListingSource({} as never, null)).map((t) => t.name)).toEqual([
    KNOWLEDGE_TOOL,
  ]);
  expect(await knowledgeListingSource({} as never, { userText: '', webSearch: false })).toEqual([]);
});

function directCall(target: AgentPublic, policies: Record<string, 'auto' | 'ask' | 'off'> = {}) {
  const specs: RunSpec[] = [];
  const kb = knowledge();
  startTargetRun(
    {
      messages: {} as never,
      manager: { start: (g, run) => void run(g) },
      runDeps: {} as RunDeps,
      clock: { now: () => 5 } as never,
      log,
      toolsHttp: {} as never,
      knowledge: kb,
      run: async (spec) => {
        specs.push(spec);
      },
    },
    {
      auth: { userId: 'usr_1', dek: Buffer.alloc(32) } as never,
      conversationId: 'cnv_1',
      message: { id: 'msg_a', model: { providerId: 'prv_1', modelId: 'm1' } } as MessagePublic,
      target: {
        ref: { providerId: 'prv_1', modelId: 'm1' },
        provider: { id: 'prv_1', kind: 'openai-compatible' } as unknown as ResolvedProvider,
        model: null,
      },
      plan: { kind: 'none' },
      path: [],
      chat: { ...defaultSettings().chat, includeDate: false },
      options: { timeZone: 'UTC' } as never,
      toolSettings: { ...defaultSettings().tools, policies },
      available: [],
      userText: 'apa itu aturan rantai?',
      endUserId: 'u',
      now: 5,
      searchesPerTask: 3,
      agent: target,
    },
  );
  const spec = specs[0] as RunSpec;
  return { spec, kb, system: JSON.stringify(spec.request.messages[0]) };
}

test('a direct call to an agent with ready files offers the tool and adds the guidance', async () => {
  const { spec, kb, system } = directCall(agent('agt_kb'));
  expect(spec.tools?.defs.map((d) => d.name)).toEqual([KNOWLEDGE_TOOL]);
  expect(system).toContain('kalkulus.pdf; notes.md');
  // Searches only this agent's files.
  await spec.tools?.get(KNOWLEDGE_TOOL)?.execute({ query: 'rantai' }, ctx);
  expect(kb.search).toHaveBeenCalledWith(expect.anything(), 'agt_kb', 'rantai');
});

test('an agent without files gets neither the tool nor the guidance; off removes both', () => {
  const none = directCall(agent('agt_plain'));
  expect(none.spec.tools).toBeUndefined();
  expect(none.system).not.toContain('search_knowledge');
  const off = directCall(agent('agt_kb'), { [KNOWLEDGE_TOOL]: 'off' });
  expect(off.spec.tools).toBeUndefined();
  expect(off.system).not.toContain('search_knowledge');
});

function delegation(policies: Record<string, 'auto' | 'ask' | 'off'> = {}) {
  const deps = delegateDepsFor(
    {
      agents: { list: () => [agent('agt_kb'), agent('agt_plain')] },
      providers: { cachedModel: () => null } as never,
      quotas: { assertWithin: () => {} } as never,
      usage: {} as never,
      knowledge: knowledge(),
      clock: createFakeClock(),
      log,
    },
    {
      auth: { userId: 'usr_1', dek: Buffer.alloc(32) } as never,
      conversationId: 'cnv_1',
      messageId: 'msg_a',
      target: {
        ref: { providerId: 'prv_1', modelId: 'm1' },
        provider: { id: 'prv_1', kind: 'openai-compatible' } as unknown as ResolvedProvider,
      },
      plan: { kind: 'none' },
      toolSettings: { ...defaultSettings().tools, policies },
      searchesPerTask: 3,
      endUserId: 'u',
    },
  );
  const inputs: SubagentInput[] = [];
  const streamChat = vi.fn(async function* () {
    yield text('ok');
    yield stop;
  });
  const tool = createDelegateTool({
    ...deps,
    model: () => ({
      adapter: { streamChat } as unknown as ProviderAdapter,
      provider: {} as never,
      providerId: 'prv_1',
      modelId: 'm1',
    }),
    run: async (input) => {
      inputs.push(input);
      return { report: 'done', ok: true };
    },
  });
  return { tool, inputs };
}

const threeTasks = {
  tasks: [
    { title: 'A', instructions: 'Use the notes.', agent: 'agt_kb' },
    { title: 'B', instructions: 'Other agent.', agent: 'agt_plain' },
    { title: 'C', instructions: 'Generic.' },
  ],
};

test('an agent-backed sub-agent gets the tool and guidance; others do not', async () => {
  const { tool, inputs } = delegation();
  await tool.execute(threeTasks, ctx);
  const [kb, plain, generic] = inputs as [SubagentInput, SubagentInput, SubagentInput];
  expect(kb.tools.map((t) => t.name)).toEqual([KNOWLEDGE_TOOL]);
  expect(kb.system).toContain('kalkulus.pdf; notes.md');
  expect(kb.system.startsWith('You are agt_kb.')).toBe(true);
  expect(plain.tools).toEqual([]);
  expect(plain.system).not.toContain('search_knowledge');
  expect(generic.tools.map((t) => t.name)).not.toContain(KNOWLEDGE_TOOL);
  expect(generic.system.startsWith(GENERIC_SUBAGENT_PROMPT)).toBe(true);
  expect(generic.system).not.toContain('search_knowledge');
});

test('the off policy keeps the tool from sub-agents too; ask does not', async () => {
  const off = delegation({ [KNOWLEDGE_TOOL]: 'off' });
  await off.tool.execute(threeTasks, ctx);
  expect(off.inputs[0]?.tools).toEqual([]);
  const ask = delegation({ [KNOWLEDGE_TOOL]: 'ask' });
  await ask.tool.execute(threeTasks, ctx);
  expect(ask.inputs[0]?.tools.map((t) => t.name)).toEqual([KNOWLEDGE_TOOL]);
});
