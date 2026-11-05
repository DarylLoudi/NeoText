import type { ChatRequestBody, MessagePublic } from '@neotext/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createQueryClient } from '../../../lib/query';
import { resetGenerations } from '../../../state/generations';
import { eventsFor, msg, sseStream, summary } from '../../../test/chat-fixtures';
import { resetFakeSettings, setFakeSettings } from '../../../test/fake-settings';
import { server } from '../../../test/msw';
import { useChatStream } from './use-chat-stream';
import { webChoiceFor } from './web-choice';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../../state/settings', () => import('../../../test/fake-settings'));

const sources = {
  type: 'sources' as const,
  sources: [{ n: 1, url: 'https://a.example/', title: 'A', snippet: '', domain: 'a.example' }],
};
const u1 = msg({ id: 'u1', role: 'user', createdAt: 1 });
const webAnswer = msg({ id: 'a1', parentId: 'u1', parts: [sources], createdAt: 2 });
const u2 = msg({ id: 'u2', role: 'user', parentId: 'a1', createdAt: 3 });
const plainAnswer = msg({
  id: 'a2',
  parentId: 'u2',
  parts: [{ type: 'text', text: 'ok' }],
  createdAt: 4,
});

let posted: ChatRequestBody[] = [];
beforeEach(() => {
  resetGenerations();
  resetFakeSettings();
  posted = [];
  server.use(
    http.get('/api/generations/active', () => HttpResponse.json({ items: [] })),
    http.get('/api/conversations/cnv_1', () =>
      HttpResponse.json({
        conversation: summary({ activeLeafId: 'a2', messageCount: 4 }),
        messages: [u1, webAnswer, u2, plainAnswer],
      }),
    ),
    http.get('/api/generations/gen_9/stream', () => {
      const done = msg({ id: 'a9', parentId: 'u9', createdAt: 9 });
      const r = eventsFor('gen_9', 5);
      return new HttpResponse(sseStream([r.snapshot(done), r.finished(done)]), {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }),
    http.post('/api/chat', async ({ request }) => {
      posted.push((await request.json()) as ChatRequestBody);
      const user = msg({ id: 'u9', role: 'user', createdAt: 9 });
      const started = msg({ id: 'a9', parentId: 'u9', status: 'streaming', createdAt: 9 });
      return new HttpResponse(sseStream([eventsFor('gen_9').started(started, user)]), {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }),
  );
});

async function ready() {
  const queryClient = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useChatStream('cnv_1'), { wrapper });
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  return view.result;
}
const lastWebSearch = () => posted.at(-1)?.options.webSearch;
afterEach(() => {
  resetGenerations();
});

test('retrying an answer that cited the web searches again, even with the default off', async () => {
  const stream = await ready();
  await act(async () => {
    await stream.current.regenerate('u1');
  });
  expect(lastWebSearch()).toBe(true);
});

test('an answer with no web sources follows the default', async () => {
  const stream = await ready();
  await act(async () => {
    await stream.current.regenerate('u2');
  });
  expect(lastWebSearch()).toBe(false);
  await waitFor(() => expect(stream.current.generating).toBe(false));
  setFakeSettings({ settings: { webSearch: { defaultOn: true } } });
  await act(async () => {
    await stream.current.regenerate('u2');
  });
  expect(lastWebSearch()).toBe(true);
  expect(posted).toHaveLength(2);
});

test('edit and resend keeps the web choice of the edited message', async () => {
  const stream = await ready();
  await act(async () => {
    await stream.current.editAndResend(u1, 'harga btc hari ini?');
  });
  expect(lastWebSearch()).toBe(true);
  await waitFor(() => expect(stream.current.generating).toBe(false));
  await act(async () => {
    await stream.current.editAndResend(u2, 'lagi');
  });
  expect(lastWebSearch()).toBe(false);
  expect(posted).toHaveLength(2);
});

test('edit and resend keeps the files of the edited message', async () => {
  const stream = await ready();
  const withFiles = {
    ...u1,
    parts: [
      { type: 'text' as const, text: 'see' },
      {
        type: 'attachment' as const,
        attachmentId: 'att_1',
        name: 'a.png',
        mime: 'image/png',
        size: 1,
      },
      {
        type: 'attachment' as const,
        attachmentId: '',
        name: 'gone.pdf',
        mime: 'application/pdf',
        size: 1,
      },
    ],
  };
  await act(async () => {
    await stream.current.editAndResend(withFiles, 'see again');
  });
  expect(posted.at(-1)?.userMessage?.attachmentIds).toEqual(['att_1']);
});

test('the latest answer decides', () => {
  const again = msg({ id: 'a1b', parentId: 'u1', createdAt: 5 });
  const messages: MessagePublic[] = [u1, webAnswer, again];
  expect(webChoiceFor(messages, 'u1', false)).toBe(false);
  const laterWeb = { ...webAnswer, id: 'a1c', createdAt: 6 };
  expect(webChoiceFor([...messages, laterWeb], 'u1', false)).toBe(true);
  expect(webChoiceFor([u1], 'u1', true)).toBe(true);
});
