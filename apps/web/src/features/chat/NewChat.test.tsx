import type { ChatRequestBody, ConversationDetail } from '@neotext/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { resetGenerations } from '../../state/generations';
import { eventsFor, msg, sseStream, summary } from '../../test/chat-fixtures';
import { resetFakeSettings, setFakeSettings } from '../../test/fake-settings';
import { catalog, deepseek, deepseekFlash, modelsResponse } from '../../test/model-fixtures';
import { server } from '../../test/msw';
import { mockBackend, renderApp } from '../../test/renderApp';
import { stubLayout } from '../../test/sidebar-backend';
import { resetWarmThrottle } from './composer/warm';

vi.mock('../../state/settings', () => import('../../test/fake-settings'));

const target = { providerId: 'prv_1', modelId: deepseekFlash.id };
let bodies: ChatRequestBody[] = [];
let restoreLayout: () => void;

function serveChat() {
  const created = summary({ id: 'cnv_new', title: null, modelRef: target });
  let detail: ConversationDetail | null = null;
  server.use(
    http.post('/api/chat', async ({ request }) => {
      const body = (await request.json()) as ChatRequestBody;
      bodies.push(body);
      const user = msg({
        id: 'u1',
        conversationId: 'cnv_new',
        role: 'user',
        parts: [{ type: 'text', text: body.userMessage?.text ?? '' }],
      });
      const started = msg({
        id: 'a1',
        conversationId: 'cnv_new',
        parentId: 'u1',
        status: 'streaming',
        model: target,
      });
      const done = {
        ...started,
        status: 'complete' as const,
        parts: [{ type: 'text' as const, text: 'Hai juga' }],
      };
      detail = {
        conversation: { ...created, activeLeafId: 'a1', messageCount: 2 },
        messages: [user, done],
      };
      const e = eventsFor('gen_1');
      return new HttpResponse(
        sseStream([e.started(started, user), e.text('Hai juga'), e.finished(done)]),
        {
          headers: { 'Content-Type': 'text/event-stream' },
        },
      );
    }),
    http.get('/api/conversations/cnv_new', () =>
      detail
        ? HttpResponse.json(detail)
        : HttpResponse.json({ error: { code: 'not_found', message: 'No.' } }, { status: 404 }),
    ),
  );
}

beforeEach(() => {
  resetFakeSettings();
  resetGenerations();
  resetWarmThrottle();
  mockBackend({ signedIn: true });
  restoreLayout = stubLayout();
  server.use(
    http.get('/api/models', () => HttpResponse.json(modelsResponse(catalog))),
    http.get('/api/tools', () => HttpResponse.json({ tools: [], webSearchBackend: false })),
    http.post('/api/providers/:id/warm', () => new HttpResponse(null, { status: 204 })),
  );
});
afterEach(() => {
  restoreLayout();
  bodies = [];
});

test('a new chat has no greeting: the model sheet and the composer', async () => {
  setFakeSettings({
    settings: { chat: { defaultModel: { providerId: 'prv_1', modelId: deepseek.id } } },
  });
  renderApp('/');
  const sheet = await screen.findByRole('region', { name: 'DeepSeek V4.1' });
  expect(within(sheet).getByText('1M tokens')).toBeInTheDocument();
  expect(within(sheet).getByText('$0.045 per 1M tokens')).toBeInTheDocument();
  expect(within(sheet).getByText('$0.50 per 1M tokens')).toBeInTheDocument();
  expect(within(sheet).getByText('January 2026')).toBeInTheDocument();
  expect(within(sheet).getByText('text, images, tools, and reasoning')).toBeInTheDocument();
  expect(screen.queryByText('What are we working on?')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
  // The picker in the top bar names the model too.
  expect(screen.getByRole('button', { name: 'DeepSeek V4.1' })).toBeInTheDocument();
});

test('the first message creates the chat and moves to its page', async () => {
  serveChat();
  const { user, router } = renderApp('/');
  const box = await screen.findByRole('textbox', { name: 'Message' });
  await screen.findByRole('region', { name: 'DeepSeek V4.1' });
  await user.click(box);
  await user.type(box, 'Halo!{Enter}');

  await waitFor(() => expect(router.state.location.pathname).toBe('/c/cnv_new'));
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({
    conversationId: null,
    parentId: null,
    userMessage: { text: 'Halo!', attachmentIds: [] },
    targets: [{ providerId: 'prv_1', modelId: deepseek.id }],
  });
  expect(await screen.findByText('Hai juga')).toBeInTheDocument();
  expect(screen.getByText('Halo!')).toBeInTheDocument();
  // The sheet gives way to the transcript.
  expect(screen.queryByRole('region', { name: 'DeepSeek V4.1' })).not.toBeInTheDocument();
});

test('a model picked in the top bar is where the message goes', async () => {
  serveChat();
  const { user } = renderApp('/');
  const trigger = await screen.findByRole('button', { name: 'DeepSeek V4.1' });
  await user.click(trigger);
  await user.click(await screen.findByText('Acme Free'));
  expect(await screen.findByRole('button', { name: 'Acme Free' })).toBeInTheDocument();
  const box = screen.getByRole('textbox', { name: 'Message' });
  expect(box).toHaveAttribute('placeholder', 'Message Acme Free');
  await user.type(box, 'Hi{Enter}');
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]?.targets).toEqual([{ providerId: 'prv_1', modelId: 'acme/free-1' }]);
});

test('a failed first send keeps the text and the page', async () => {
  server.use(
    http.post('/api/chat', () =>
      HttpResponse.json(
        {
          error: {
            code: 'rate_limited',
            message: 'Too many messages. Wait a minute, then send again.',
          },
        },
        { status: 429 },
      ),
    ),
  );
  const { user, router } = renderApp('/');
  const box = await screen.findByRole('textbox', { name: 'Message' });
  await user.type(box, 'Halo!{Enter}');
  expect(
    await screen.findByText('Too many messages. Wait a minute, then send again.'),
  ).toBeInTheDocument();
  expect(box).toHaveValue('Halo!');
  expect(router.state.location.pathname).toBe('/');
  // And the button is free again.
  expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
});

test('without a provider, the sheet says how to connect one', async () => {
  server.use(http.get('/api/models', () => HttpResponse.json({ providers: [] })));
  const { user, router } = renderApp('/');
  expect(await screen.findByText('Connect a model provider to start.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Choose a model' })).toBeInTheDocument();
  await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Halo{Enter}');
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  expect(bodies).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Open provider settings' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/settings/providers'));
});

test('a title that arrives after the answer is not overwritten by a refetch that started before it', async () => {
  const created = summary({ id: 'cnv_new', title: null, modelRef: target });
  const user1 = msg({
    id: 'u1',
    conversationId: 'cnv_new',
    role: 'user',
    parts: [{ type: 'text', text: 'Halo!' }],
  });
  const started = msg({
    id: 'a1',
    conversationId: 'cnv_new',
    parentId: 'u1',
    status: 'streaming',
    model: target,
  });
  const done = {
    ...started,
    status: 'complete' as const,
    parts: [{ type: 'text' as const, text: 'Hai juga' }],
  };
  // What the server holds: it saves the title, then sends `conversation.updated`.
  let titleSaved = false;
  let releaseStale: () => void = () => {};
  const staleGate = new Promise<void>((r) => {
    releaseStale = r;
  });
  let sendTitle: () => void = () => {};
  const titleGate = new Promise<void>((r) => {
    sendTitle = r;
  });
  const current = () => ({
    ...created,
    title: titleSaved ? 'Salam pembuka' : null,
    activeLeafId: 'a1',
    messageCount: 2,
  });
  // A read answers with what the server held when the read was made, however late it arrives.
  async function read<T>(make: () => T): Promise<T> {
    const answer = make();
    if (!titleSaved) await staleGate;
    return answer;
  }
  server.use(
    http.post('/api/chat', () => {
      const e = eventsFor('gen_1');
      const events = [e.started(started, user1), e.text('Hai juga'), e.finished(done)];
      const titled = e.titled('cnv_new', 'Salam pembuka');
      const encoder = new TextEncoder();
      const frame = (ev: unknown) => encoder.encode(`data: ${JSON.stringify(ev)}\n\n`);
      return new HttpResponse(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            for (const ev of events) controller.enqueue(frame(ev));
            await titleGate;
            controller.enqueue(frame(titled));
            controller.close();
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    }),
    http.get('/api/conversations/cnv_new', () =>
      read(() => HttpResponse.json({ conversation: current(), messages: [user1, done] })),
    ),
    http.get('/api/conversations', () =>
      read(() => HttpResponse.json({ items: [current()], nextCursor: null })),
    ),
  );

  const { user } = renderApp('/');
  const box = await screen.findByRole('textbox', { name: 'Message' });
  await screen.findByRole('region', { name: 'DeepSeek V4.1' });
  await user.type(box, 'Halo!{Enter}');
  await screen.findByText('Hai juga');

  // The refetches that follow the answer were made before the title existed.
  titleSaved = true;
  sendTitle();
  expect(await screen.findByRole('heading', { level: 1, name: 'Salam pembuka' })).toBeVisible();
  releaseStale();
  // Let the late answers land, then check the title is still there.
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.getByRole('heading', { level: 1, name: 'Salam pembuka' })).toBeVisible();
});
