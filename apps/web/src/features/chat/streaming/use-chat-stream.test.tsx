import type { ChatRequestBody, ConversationDetail } from '@neotext/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createQueryClient } from '../../../lib/query';
import { liveMessageFor, resetGenerations } from '../../../state/generations';
import { eventsFor, msg, sseStream, summary } from '../../../test/chat-fixtures';
import { server } from '../../../test/msw';
import { useChatStream } from './use-chat-stream';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

const model = { providerId: 'prv_1', modelId: 'acme/neo-writer-2' };
const u1 = msg({ id: 'u1', role: 'user', createdAt: 1 });
const a1 = msg({ id: 'a1', parentId: 'u1', createdAt: 2 });
const a2 = msg({ id: 'a2', parentId: 'u1', createdAt: 3 });

let posted: ChatRequestBody[] = [];
beforeEach(() => {
  resetGenerations();
  posted = [];
  server.use(
    http.get('/api/generations/active', () => HttpResponse.json({ items: [] })),
    // The start stream above ends without `finished`, so the client resumes; let that end too.
    http.get('/api/generations/gen_9/stream', () => {
      const done = msg({ id: 'a9', parentId: 'u9', createdAt: 9 });
      const r = eventsFor('gen_9', 5);
      return new HttpResponse(sseStream([r.snapshot(done), r.finished(done)]), {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }),
    http.post('/api/chat', async ({ request }) => {
      const body = (await request.json()) as ChatRequestBody;
      posted.push(body);
      const user = msg({ id: 'u9', role: 'user', parentId: body.parentId, createdAt: 9 });
      const started = msg({ id: 'a9', parentId: 'u9', status: 'streaming', createdAt: 9 });
      const e = eventsFor('gen_9');
      return new HttpResponse(sseStream([e.started(started, user)]), {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }),
  );
});
afterEach(() => {
  resetGenerations();
});

function setup(conversationId: string | null) {
  const queryClient = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useChatStream(conversationId), { wrapper });
  return { ...view, queryClient };
}

test('a chat whose messages have not loaded is not ready, and a send is refused', async () => {
  let answer: (d: ConversationDetail) => void = () => {};
  server.use(
    http.get(
      '/api/conversations/cnv_1',
      () =>
        new Promise<Response>((resolve) => {
          answer = (d) => resolve(HttpResponse.json(d));
        }),
    ),
  );
  const { result } = setup('cnv_1');
  expect(result.current.ready).toBe(false);
  let sent: boolean | undefined;
  await act(async () => {
    sent = await result.current.send('halo', { targets: [model] });
  });
  expect(sent).toBe(false);
  expect(posted).toEqual([]);

  answer({ conversation: summary({ activeLeafId: 'a1', messageCount: 2 }), messages: [u1, a1] });
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => {
    sent = await result.current.send('halo', { targets: [model] });
  });
  expect(sent).toBe(true);
  expect(posted[0]).toMatchObject({ conversationId: 'cnv_1', parentId: 'a1' });
});

test('a new chat is ready at once', () => {
  const { result } = setup(null);
  expect(result.current.ready).toBe(true);
});

test('a chat without a saved leaf continues from the newest answer it shows', async () => {
  server.use(
    http.get('/api/conversations/cnv_1', () =>
      HttpResponse.json({
        conversation: summary({ activeLeafId: null, messageCount: 3 }),
        messages: [u1, a1, a2],
      }),
    ),
  );
  const { result } = setup('cnv_1');
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => {
    await result.current.send('halo', { targets: [model] });
  });
  expect(posted[0]).toMatchObject({ conversationId: 'cnv_1', parentId: 'a2' });
});

const writing = msg({
  id: 'a3',
  parentId: 'u1',
  status: 'streaming',
  parts: [{ type: 'text', text: 'Ha' }],
  createdAt: 4,
});
const written = {
  ...writing,
  status: 'complete' as const,
  parts: [{ type: 'text' as const, text: 'Halo' }],
};
const streamingDetail = () => ({
  conversation: summary({ activeLeafId: 'a3', messageCount: 3 }),
  messages: [u1, a1, writing],
});

test('an answer still being written when the chat loads is found and resumed', async () => {
  const r = eventsFor('gen_3');
  let activeAsked = 0;
  let resumed = false;
  server.use(
    http.get('/api/conversations/cnv_1', () =>
      HttpResponse.json(
        resumed
          ? {
              conversation: summary({ activeLeafId: 'a3', messageCount: 3 }),
              messages: [u1, a1, written],
            }
          : streamingDetail(),
      ),
    ),
    http.get('/api/generations/active', () => {
      activeAsked += 1;
      return HttpResponse.json({
        items: [
          {
            id: 'gen_3',
            conversationId: 'cnv_1',
            assistantMessageId: 'a3',
            model,
            startedAt: 4,
          },
        ],
      });
    }),
    http.get('/api/generations/gen_3/stream', () => {
      resumed = true;
      return new HttpResponse(sseStream([r.snapshot(writing), r.text('lo'), r.finished(written)]), {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }),
  );
  const { result, queryClient } = setup('cnv_1');
  await waitFor(() => expect(liveMessageFor('a3')?.status).toBe('complete'));
  expect(liveMessageFor('a3')).toEqual(written);
  expect(activeAsked).toBeGreaterThanOrEqual(1);
  expect(result.current.generating).toBe(false);
  await waitFor(() =>
    expect(
      queryClient
        .getQueryData<ConversationDetail>(['conversation', 'cnv_1'])
        ?.messages.find((m) => m.id === 'a3')?.status,
    ).toBe('complete'),
  );
  // Let the refetches the end of the answer triggers settle, so none is cut off at teardown.
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
});

test('a streaming answer nothing runs for is refreshed once, without resuming', async () => {
  let loads = 0;
  let resumed = false;
  server.use(
    http.get('/api/conversations/cnv_1', () => {
      loads += 1;
      return HttpResponse.json(
        loads === 1
          ? streamingDetail()
          : {
              conversation: summary({ activeLeafId: 'a3', messageCount: 3 }),
              messages: [u1, a1, written],
            },
      );
    }),
    http.get('/api/generations/gen_3/stream', () => {
      resumed = true;
      return HttpResponse.error();
    }),
  );
  const { queryClient } = setup('cnv_1');
  await waitFor(() => expect(loads).toBe(2));
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  expect(resumed).toBe(false);
  expect(liveMessageFor('a3')).toBeUndefined();
});
