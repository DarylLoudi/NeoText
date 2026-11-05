import type { ChatRequestBody, ConversationDetail } from '@neotext/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { resetGenerations } from '../../state/generations';
import { eventsFor, msg, sseStream, summary } from '../../test/chat-fixtures';
import { resetFakeSettings } from '../../test/fake-settings';
import { modelInfo, modelsResponse } from '../../test/model-fixtures';
import { server } from '../../test/msw';
import { mockBackend, renderApp } from '../../test/renderApp';
import { stubLayout } from '../../test/sidebar-backend';
import { resetWarmThrottle } from './composer/warm';

vi.mock('../../state/settings', () => import('../../test/fake-settings'));

const m1 = { providerId: 'prv_1', modelId: 'acme/neo-writer-2' };
const m2 = { providerId: 'prv_1', modelId: 'acme/neo-critic-1' };
const u1 = msg({ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Outline chapter 2' }] });
const a1 = msg({
  id: 'a1',
  parentId: 'u1',
  createdAt: 2,
  model: m1,
  parts: [{ type: 'text', text: 'First try' }],
});

let bodies: ChatRequestBody[] = [];
let restoreLayout: () => void;
beforeEach(() => {
  resetFakeSettings();
  resetGenerations();
  resetWarmThrottle();
  mockBackend({ signedIn: true });
  restoreLayout = stubLayout();
  let detail: ConversationDetail = {
    conversation: summary({ activeLeafId: 'a1', messageCount: 2, modelRef: m1 }),
    messages: [u1, a1],
  };
  server.use(
    http.get('/api/models', () =>
      HttpResponse.json(
        modelsResponse([
          modelInfo({ id: m1.modelId, name: 'Neo Writer 2' }),
          modelInfo({ id: m2.modelId, name: 'Neo Critic 1' }),
        ]),
      ),
    ),
    http.post('/api/providers/:id/warm', () => new HttpResponse(null, { status: 204 })),
    http.get('/api/tools', () => HttpResponse.json({ tools: [], webSearchBackend: false })),
    http.get('/api/conversations/cnv_1', () => HttpResponse.json(detail)),
    http.post('/api/chat', async ({ request }) => {
      const body = (await request.json()) as ChatRequestBody;
      bodies.push(body);
      const started = msg({
        id: 'a2',
        parentId: body.parentId as string,
        status: 'streaming',
        createdAt: 5,
        model: body.targets[0] ?? null,
      });
      const done = {
        ...started,
        status: 'complete' as const,
        parts: [{ type: 'text' as const, text: 'Critic says hi' }],
      };
      detail = {
        conversation: { ...detail.conversation, activeLeafId: 'a2' },
        messages: [...detail.messages, done],
      };
      const e = eventsFor('gen_a2');
      return new HttpResponse(
        sseStream([e.started(started), e.text('Critic says hi'), e.finished(done)]),
        {
          headers: { 'Content-Type': 'text/event-stream' },
        },
      );
    }),
  );
});
afterEach(() => {
  restoreLayout();
  bodies = [];
});

test('regenerate with another model sends that target', async () => {
  const { user } = renderApp('/c/cnv_1');
  await screen.findByText('First try');
  await user.click(screen.getByRole('button', { name: 'Regenerate with another model' }));
  const search = await screen.findByRole('combobox', { name: 'Search models' });
  await user.type(search, 'critic');
  const list = screen.getByRole('listbox');
  await user.click(within(list).getByText('Neo Critic 1'));

  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toMatchObject({
    conversationId: 'cnv_1',
    parentId: 'u1',
    userMessage: null,
    targets: [m2],
  });
  expect(await screen.findByText('Critic says hi')).toBeInTheDocument();
});

test('plain regenerate still uses the answer model', async () => {
  const { user } = renderApp('/c/cnv_1');
  await screen.findByText('First try');
  await user.click(screen.getByRole('button', { name: 'Regenerate' }));
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]?.targets).toEqual([m1]);
});

test('continue in new chat navigates to the copy', async () => {
  const forked: unknown[] = [];
  const copy = summary({ id: 'cnv_2', title: 'Thesis outline help (copy)', activeLeafId: 'b2' });
  server.use(
    http.post('/api/conversations/cnv_1/fork', async ({ request }) => {
      forked.push(await request.json());
      return HttpResponse.json(copy, { status: 201 });
    }),
    http.get('/api/conversations/cnv_2', () =>
      HttpResponse.json({
        conversation: copy,
        messages: [
          msg({ id: 'b1', role: 'user', parts: [{ type: 'text', text: 'Outline chapter 2' }] }),
          msg({
            id: 'b2',
            parentId: 'b1',
            createdAt: 2,
            model: m1,
            parts: [{ type: 'text', text: 'Copied answer' }],
          }),
        ],
      }),
    ),
  );
  const { user } = renderApp('/c/cnv_1');
  await screen.findByText('First try');
  await user.click(
    screen.getAllByRole('button', { name: 'Continue in new chat' })[1] as HTMLElement,
  );
  expect(await screen.findByText('Copied answer')).toBeInTheDocument();
  expect(forked).toEqual([{ messageId: 'a1' }]);
});
