import type { ConversationDetail, MessagePublic } from '@neotext/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test, vi } from 'vitest';
import { createQueryClient, qk } from '../../lib/query';
import { flushEvents, ingestEvents, markLost, resetGenerations } from '../../state/generations';
import { eventsFor, msg, summary } from '../../test/chat-fixtures';
import { resetFakeSettings } from '../../test/fake-settings';
import { server } from '../../test/msw';
import { TooltipProvider } from '../../ui';
import { CompareColumns } from './CompareColumns';
import { isChosen, resetCompare } from './compare-state';

vi.mock('../../state/settings', () => import('../../test/fake-settings'));

const u1 = msg({ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Name a colour' }] });
const a = msg({
  id: 'a',
  parentId: 'u1',
  createdAt: 5,
  model: { providerId: 'prv_1', modelId: 'acme/alpha-1' },
  usage: {
    promptTokens: 10,
    completionTokens: 20,
    reasoningTokens: 0,
    cachedTokens: 0,
    costUsd: 0.042,
    webSearchRequests: 0,
    ttftMs: null,
    durationMs: 2400,
    upstreamProvider: null,
  },
  parts: [{ type: 'text', text: 'Red' }],
});
const b = msg({
  id: 'b',
  parentId: 'u1',
  createdAt: 5,
  model: { providerId: 'prv_1', modelId: 'acme/beta-2' },
  parts: [{ type: 'text', text: 'Blue' }],
});

let patches: unknown[] = [];
let aborted: string[] = [];
beforeEach(() => {
  resetFakeSettings();
  resetGenerations();
  resetCompare();
  patches = [];
  aborted = [];
  server.use(
    http.patch('/api/conversations/cnv_1', async ({ request }) => {
      const body = await request.json();
      patches.push(body);
      return HttpResponse.json(summary(body as object));
    }),
    http.post('/api/generations/:id/abort', ({ params }) => {
      aborted.push(String(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
  );
});

function setup(group: MessagePublic[], messages: MessagePublic[] = [u1, ...group]) {
  const qc = createQueryClient();
  const detail: ConversationDetail = {
    conversation: summary({ activeLeafId: group[0]?.id ?? null, messageCount: messages.length }),
    messages,
  };
  qc.setQueryData(qk.conversation('cnv_1'), detail);
  const user = userEvent.setup();
  const view = render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <CompareColumns
          conversationId="cnv_1"
          group={group}
          activeId={group[0]?.id ?? ''}
          showCost
          codeTheme="auto"
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  const column = (name: string) => {
    const el = screen.getByRole('region', { name });
    return within(el);
  };
  return { qc, user, view, column };
}

test('each column names its model with duration and cost', () => {
  const { column } = setup([a, b]);
  expect(column('alpha 1').getByText('2.4 s')).toBeInTheDocument();
  expect(column('alpha 1').getByText('$0.042')).toBeInTheDocument();
  expect(column('alpha 1').getByText('Red')).toBeInTheDocument();
  expect(column('beta 2').getByText('Blue')).toBeInTheDocument();
});

test('choosing an answer sets the active leaf', async () => {
  // b was continued in another tab: its newest leaf is the one the chat moves to.
  const u2 = msg({ id: 'u2', role: 'user', parentId: 'b', createdAt: 7 });
  const b2 = msg({ id: 'b2', parentId: 'u2', createdAt: 8 });
  const { user, column, qc } = setup([a, b], [u1, a, b, u2, b2]);
  await user.click(column('beta 2').getByRole('button', { name: 'Continue with this answer' }));
  await waitFor(() => expect(patches).toEqual([{ activeLeafId: 'b2' }]));
  expect(
    qc.getQueryData<ConversationDetail>(qk.conversation('cnv_1'))?.conversation.activeLeafId,
  ).toBe('b2');
  expect(isChosen('u1')).toBe(true);
});

test('columns stream independently', () => {
  const liveA = { ...a, status: 'streaming' as const, parts: [], usage: null };
  const liveB = { ...b, status: 'streaming' as const, parts: [] };
  const { column } = setup([liveA, liveB]);
  const ea = eventsFor('gen_a');
  const eb = eventsFor('gen_b');
  act(() => {
    ingestEvents([ea.started(liveA, u1), eb.started(liveB, u1)]);
    ingestEvents([ea.text('Crimson'), eb.text('Navy'), ea.text(' red')]);
    flushEvents();
  });
  expect(column('alpha 1').getByText('Crimson red')).toBeInTheDocument();
  expect(column('beta 2').getByText('Navy')).toBeInTheDocument();
  expect(column('alpha 1').queryByText('Navy')).not.toBeInTheDocument();
  // Still being written: no choice yet, and each has its own stop.
  expect(column('alpha 1').queryByRole('button', { name: 'Continue with this answer' })).toBeNull();
  expect(column('beta 2').getByRole('button', { name: 'Stop this answer' })).toBeInTheDocument();
});

test('a column stops only its own answer', async () => {
  const liveA = { ...a, status: 'streaming' as const, parts: [] };
  const liveB = { ...b, status: 'streaming' as const, parts: [] };
  const { column, user } = setup([liveA, liveB]);
  act(() => {
    ingestEvents([eventsFor('gen_a').started(liveA, u1), eventsFor('gen_b').started(liveB, u1)]);
    flushEvents();
  });
  await user.click(column('beta 2').getByRole('button', { name: 'Stop this answer' }));
  await waitFor(() => expect(aborted).toEqual(['gen_b']));
});

test('a choice that could not be saved keeps the columns', async () => {
  server.use(
    http.patch('/api/conversations/cnv_1', () =>
      HttpResponse.json(
        { error: { code: 'internal', message: 'Saving failed.' } },
        { status: 500 },
      ),
    ),
  );
  const { user, column, qc } = setup([a, b]);
  await user.click(column('beta 2').getByRole('button', { name: 'Continue with this answer' }));
  await waitFor(() =>
    expect(
      qc.getQueryData<ConversationDetail>(qk.conversation('cnv_1'))?.conversation.activeLeafId,
    ).toBe('a'),
  );
  expect(isChosen('u1')).toBe(false);
});

test('the column the thread continues from says so', () => {
  const { column } = setup([a, b]);
  expect(column('alpha 1').getByText('Continues from here')).toBeInTheDocument();
  expect(column('beta 2').queryByText('Continues from here')).toBeNull();
});

test('a column notes an answer that did not end normally', () => {
  const { column } = setup([
    { ...a, status: 'interrupted' },
    { ...b, finishReason: 'length' },
  ]);
  expect(
    column('alpha 1').getByText(
      'The server restarted while this was being written. You can regenerate it.',
    ),
  ).toBeInTheDocument();
  expect(column('beta 2').getByText('Cut off at the length limit.')).toBeInTheDocument();
});

test('a lost stream is noted in its column', () => {
  const liveA = { ...a, status: 'streaming' as const, parts: [] };
  const { column } = setup([liveA, b]);
  act(() => {
    ingestEvents([eventsFor('gen_a').started(liveA, u1)]);
    flushEvents();
    markLost('gen_a');
  });
  expect(
    column('alpha 1').getByText('Lost the connection. Reload to see the rest.'),
  ).toBeInTheDocument();
});
