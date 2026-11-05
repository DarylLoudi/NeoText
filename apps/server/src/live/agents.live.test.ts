import type { MessagePublic, StreamEvent } from '@neotext/shared';
import { expect, test } from 'vitest';
import { readEvents } from '../../test-support/sse-client';
import { authed, createTestApp, setupOwner } from '../../test-support/test-app';

// Opt-in: runs only with OPENROUTER_API_KEY set (root .env). Real network, real (small) cost.
// Checks that a real model searches and delegates only when the job calls for it.
const key = process.env.OPENROUTER_API_KEY;
const live = test.skipIf(!key);
const DEEPSEEK = 'deepseek/deepseek-v4.1-flash';

type Finished = Extract<StreamEvent, { type: 'generation.finished' }>;

/** One turn through the real chat route; optionally creates an agent first and calls it. */
async function turn(input: {
  text: string;
  maxOutputTokens: number;
  agent?: { name: string; instructions: string };
}): Promise<{ message: MessagePublic; calls: number; cost: unknown }> {
  const t = await createTestApp({ env: { OPENROUTER_API_KEY: key as string } });
  try {
    const owner = await setupOwner(t, { useEnvProvider: true });
    const api = authed(t, owner.cookie);
    const patch = {
      chat: { autoTitle: false },
      webSearch: { maxResults: 2, maxSearchesPerTurn: 2 },
      tools: { maxSubagents: 3 },
    };
    expect(
      (await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ patch }) })).ok,
    ).toBe(true);
    const list = (await (await api('/api/providers')).json()) as { providers: { id: string }[] };
    const providerId = list.providers[0]?.id as string;
    let agentId: string | null = null;
    if (input.agent) {
      const res = await api('/api/agents', {
        method: 'POST',
        body: JSON.stringify({
          name: input.agent.name,
          data: { instructions: input.agent.instructions },
        }),
      });
      agentId = ((await res.json()) as { id: string }).id;
    }
    const res = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: null,
        parentId: null,
        userMessage: { text: input.text },
        targets: [{ providerId, modelId: DEEPSEEK }],
        options: { maxOutputTokens: input.maxOutputTokens, webSearch: true, agentId },
      }),
    });
    const evs: StreamEvent[] = await readEvents(res);
    const fin = evs.find((e): e is Finished => e.type === 'generation.finished');
    if (!fin) throw new Error('The turn did not finish.');
    const rows = t.c.db.raw
      .prepare('select count(*) as n, sum(cost_usd) as c from usage_events')
      .get() as { n: number; c: unknown };
    return { message: fin.message, calls: rows.n, cost: rows.c };
  } finally {
    await t.close();
  }
}

const toolNames = (m: MessagePublic) =>
  m.parts.flatMap((p) => (p.type === 'tool_call' ? [p.name] : []));
const searched = (m: MessagePublic) =>
  (m.usage?.webSearchRequests ?? 0) > 0 || toolNames(m).includes('web_search');
const text = (m: MessagePublic) =>
  m.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('');

function report(label: string, r: { message: MessagePublic; calls: number; cost: unknown }) {
  const m = r.message;
  const runs = m.parts.flatMap((p) => (p.type === 'tool_call' && p.agents ? p.agents : []));
  console.info(
    `live ${label}: status ${m.status}, tools [${toolNames(m).join(',')}], ` +
      `searches ${m.usage?.webSearchRequests ?? 0}, sub-agents ${runs.length} ` +
      `(${runs.map((a) => a.status).join(',')}), calls ${r.calls}, cost ${r.cost} USD`,
  );
}

live('a greeting neither searches nor delegates', async () => {
  const r = await turn({ text: 'Halo! Apa kabar?', maxOutputTokens: 200 });
  report('greeting', r);
  expect(r.message.status).toBe('complete');
  expect(toolNames(r.message)).toEqual([]);
  expect(searched(r.message)).toBe(false);
});

live('a simple math question neither searches nor delegates', async () => {
  const r = await turn({ text: 'Berapa 17 x 23? Jawab angkanya saja.', maxOutputTokens: 100 });
  report('math', r);
  expect(toolNames(r.message)).toEqual([]);
  expect(searched(r.message)).toBe(false);
});

live('a question about current events searches the web', async () => {
  const r = await turn({
    text: 'What is the latest stable version of Node.js right now? One sentence.',
    maxOutputTokens: 300,
  });
  report('news', r);
  expect(r.message.status).toBe('complete');
  expect(searched(r.message)).toBe(true);
});

live(
  'a big job with independent parts is delegated to sub-agents',
  async () => {
    const r = await turn({
      text:
        'Research these three separate topics in depth and give me one combined report: ' +
        '(1) the current state of solid-state batteries for electric cars, ' +
        '(2) the latest progress in nuclear fusion power plants, ' +
        '(3) the newest developments in perovskite solar cells. ' +
        'Use current sources for each and cite them.',
      maxOutputTokens: 2000,
    });
    report('big job', r);
    expect(r.message.status).toBe('complete');
    expect(toolNames(r.message)).toContain('delegate_tasks');
    const runs = r.message.parts.flatMap((p) =>
      p.type === 'tool_call' && p.agents ? p.agents : [],
    );
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs.every((a) => a.status === 'ok')).toBe(true);
    expect(text(r.message).length).toBeGreaterThan(200);
  },
  300_000,
);

live('a custom agent called directly follows its instructions', async () => {
  const r = await turn({
    text: 'Explain what a CSS grid is.',
    maxOutputTokens: 300,
    agent: {
      name: 'Agent-Frontend',
      instructions:
        'Always start your reply with the exact word "FRONTEND:" and answer in one sentence.',
    },
  });
  report('agent', r);
  expect(r.message.parts[0]).toMatchObject({ type: 'agent', name: 'Agent-Frontend' });
  expect(text(r.message).trim().startsWith('FRONTEND:')).toBe(true);
});
