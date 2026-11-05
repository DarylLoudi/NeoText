import type { ChatRequestBody, ConversationDetail } from '@neotext/shared';
import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { resetGenerations } from '../../state/generations';
import { eventsFor, msg, sseStream, summary } from '../../test/chat-fixtures';
import { resetFakeSettings } from '../../test/fake-settings';
import { server } from '../../test/msw';
import { mockBackend, renderApp } from '../../test/renderApp';
import { stubLayout } from '../../test/sidebar-backend';

vi.mock('../../state/settings', () => import('../../test/fake-settings'));

const model = { providerId: 'prv_1', modelId: 'acme/neo-writer-2' };
const u1 = msg({ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Outline chapter 2' }] });
const a1 = msg({
  id: 'a1',
  parentId: 'u1',
  createdAt: 2,
  model,
  parts: [{ type: 'text', text: 'First try' }],
});

let requests: { body: ChatRequestBody; key: string | null }[] = [];
let restoreLayout: () => void;
beforeEach(() => {
  resetFakeSettings();
  resetGenerations();
  mockBackend({ signedIn: true });
  restoreLayout = stubLayout();
  let detail: ConversationDetail = {
    conversation: summary({ activeLeafId: 'a1', messageCount: 2 }),
    messages: [u1, a1],
  };
  server.use(
    http.get('/api/conversations/cnv_1', () => HttpResponse.json(detail)),
    http.post('/api/chat', async ({ request }) => {
      const body = (await request.json()) as ChatRequestBody;
      requests.push({ body, key: request.headers.get('Idempotency-Key') });
      const id = `a${requests.length + 1}`;
      const user = body.userMessage
        ? msg({
            id: `u${requests.length + 1}`,
            role: 'user',
            parentId: body.parentId,
            createdAt: 5,
            parts: [{ type: 'text', text: body.userMessage.text }],
          })
        : null;
      const parentId = user?.id ?? (body.parentId as string);
      const started = msg({ id, parentId, status: 'streaming', createdAt: 5, model });
      const done = {
        ...started,
        status: 'complete' as const,
        parts: [{ type: 'text' as const, text: 'Second try' }],
      };
      detail = {
        conversation: { ...detail.conversation, activeLeafId: id },
        messages: [...detail.messages, ...(user ? [user] : []), done],
      };
      const e = eventsFor(`gen_${id}`);
      return new HttpResponse(
        sseStream([e.started(started, user), e.text('Second try'), e.finished(done)]),
        {
          headers: { 'Content-Type': 'text/event-stream' },
        },
      );
    }),
  );
});
afterEach(() => {
  restoreLayout();
  requests = [];
});

test('regenerate sends the user message as parent, then shows the new version', async () => {
  const { user } = renderApp('/c/cnv_1');
  await screen.findByText('First try');
  await user.click(screen.getByRole('button', { name: 'Regenerate' }));
  expect(await screen.findByText('Second try')).toBeInTheDocument();
  expect(await screen.findByText('2 / 2')).toBeInTheDocument();
  const [{ body, key }] = requests as [(typeof requests)[number]];
  expect(body).toMatchObject({
    conversationId: 'cnv_1',
    parentId: 'u1',
    userMessage: null,
    targets: [model],
  });
  expect(body.options.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  expect(key).toMatch(/^[0-9a-f-]{36}$/);
});

test('editing sends a new version of the user turn', async () => {
  const { user } = renderApp('/c/cnv_1');
  await screen.findByText('Outline chapter 2');
  await user.click(screen.getByRole('button', { name: 'Edit message' }));
  const box = screen.getByRole('textbox', { name: 'Your message' });
  await user.clear(box);
  await user.type(box, 'Outline chapter 3');
  await user.click(screen.getByRole('button', { name: 'Save and send' }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]?.body).toMatchObject({
    conversationId: 'cnv_1',
    parentId: null,
    userMessage: { text: 'Outline chapter 3' },
    targets: [model],
  });
  expect(await screen.findByText('Outline chapter 3')).toBeInTheDocument();
  expect(await screen.findByText('Second try')).toBeInTheDocument();
});

test('a chat that does not exist says so', async () => {
  renderApp('/c/cnv_gone');
  expect(
    await screen.findByText(
      'This chat does not exist or was deleted. Start a new chat from the sidebar.',
    ),
  ).toBeInTheDocument();
});

test('a send works where randomUUID is unavailable (plain-HTTP LAN)', async () => {
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
    throw new TypeError('randomUUID needs a secure context');
  });
  const { user } = renderApp('/c/cnv_1');
  await screen.findByText('First try');
  await user.click(screen.getByRole('button', { name: 'Regenerate' }));
  expect(await screen.findByText('Second try')).toBeInTheDocument();
  expect(requests[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
  vi.restoreAllMocks();
});

test('a cached answer still streaming without a running generation is refreshed once', async () => {
  let fetches = 0;
  const stale: ConversationDetail = {
    conversation: summary({ activeLeafId: 'a1', messageCount: 2 }),
    messages: [u1, { ...a1, status: 'streaming' }],
  };
  server.use(
    http.get('/api/conversations/cnv_1', () => {
      fetches += 1;
      return HttpResponse.json(stale);
    }),
  );
  renderApp('/c/cnv_1');
  await screen.findByText('First try');
  await waitFor(() => expect(fetches).toBe(2));
  await new Promise((r) => setTimeout(r, 300));
  expect(fetches).toBe(2);
});
