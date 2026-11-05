import type { MessagePublic, ToolCallPart } from '@neotext/shared';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { qk } from '../../../lib/query';
import { resetGenerations } from '../../../state/generations';
import { msg } from '../../../test/chat-fixtures';
import { server } from '../../../test/msw';
import { renderWithClient } from '../../../test/renderWithClient';
import { PartRenderer } from '../PartRenderer';
import { CALL_RESOLVE_TIMEOUT_MS } from './use-call-life';

const waiting: ToolCallPart = {
  type: 'tool_call',
  id: 'call_7',
  name: 'fetch_url',
  source: 'app',
  args: '{"url":"https://example.com/a"}',
  status: 'awaiting_approval',
  result: null,
  startedAt: 1,
  finishedAt: null,
};
const running: ToolCallPart = { ...waiting, status: 'running' };
const saved = (part: ToolCallPart): MessagePublic =>
  msg({ id: 'msg_s', status: 'streaming', parts: [part] });
const NOTICE = 'This answer cannot be reached right now. Check your connection and try again.';
const entry = {
  id: 'gen_9',
  conversationId: 'cnv_1',
  assistantMessageId: 'msg_s',
  model: { providerId: 'prv_1', modelId: 'acme/x' },
  startedAt: 1,
};

function view(part: ToolCallPart) {
  const message = saved(part);
  return renderWithClient(
    <PartRenderer part={part} message={message} live={false} codeTheme="auto" />,
  );
}

beforeEach(() => resetGenerations());
afterEach(() => {
  cleanup();
  resetGenerations();
  vi.useRealTimers();
});

test('a prompt whose active list fails says so, and retrying resumes it', async () => {
  let activeReads = 0;
  let healthy = false;
  let streams = 0;
  let open: ReadableStreamDefaultController<Uint8Array> | null = null;
  const frame = (e: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(e)}\n\n`);
  server.use(
    http.get('/api/generations/active', () => {
      activeReads += 1;
      return healthy
        ? HttpResponse.json({ items: [entry] })
        : HttpResponse.json({ error: { code: 'internal', message: 'No.' } }, { status: 500 });
    }),
    http.get('/api/generations/:id/stream', () => {
      streams += 1;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          open = controller;
          controller.enqueue(
            frame({
              type: 'generation.snapshot',
              generationId: 'gen_9',
              seq: 1,
              message: saved(waiting),
            }),
          );
        },
      });
      return new HttpResponse(body, { headers: { 'Content-Type': 'text/event-stream' } });
    }),
  );
  const { user } = view(waiting);
  expect(await screen.findByText(NOTICE)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
  expect(streams).toBe(0);

  healthy = true;
  const before = activeReads;
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('button', { name: 'Allow' })).toBeEnabled();
  expect(activeReads).toBeGreaterThan(before);
  expect(streams).toBe(1);
  expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();

  // Ends the followed stream, so nothing keeps reconnecting after the test.
  const stream = open as ReadableStreamDefaultController<Uint8Array> | null;
  stream?.enqueue(
    frame({
      type: 'generation.finished',
      generationId: 'gen_9',
      seq: 2,
      message: { ...saved(waiting), status: 'complete' },
    }),
  );
  stream?.close();
  await waitFor(() => expect(streams).toBe(1));
});

test('a retry that finds nothing running ends as interrupted', async () => {
  let healthy = false;
  server.use(
    http.get('/api/generations/active', () =>
      healthy
        ? HttpResponse.json({ items: [] })
        : HttpResponse.json({ error: { code: 'internal', message: 'No.' } }, { status: 500 }),
    ),
    http.get('/api/conversations/:id', () =>
      HttpResponse.json({ error: { code: 'not_found', message: 'No.' } }, { status: 404 }),
    ),
  );
  const { user } = view(waiting);
  await screen.findByText(NOTICE);
  healthy = true;
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Interrupted')).toBeInTheDocument();
  expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
});

test('a call listed as active that never reconnects is bounded too', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  server.use(http.get('/api/generations/active', () => HttpResponse.json({ items: [entry] })));
  view(waiting);
  await vi.waitFor(() => expect(screen.getByText('Web page reader wants to run')).toBeTruthy());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(CALL_RESOLVE_TIMEOUT_MS - 1000);
  });
  expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(screen.getByText(NOTICE)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});

test('a running row stops spinning on the same path and offers the same retry', async () => {
  server.use(
    http.get('/api/generations/active', () =>
      HttpResponse.json({ error: { code: 'internal', message: 'No.' } }, { status: 500 }),
    ),
  );
  const { container } = view(running);
  expect(await screen.findByText(NOTICE)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  expect(screen.getByText('Not connected')).toBeInTheDocument();
  expect(container.querySelector('[class*="spinner"]')).toBeNull();
  expect(container.querySelector('details')).not.toHaveAttribute('aria-busy');
});

test('once interrupted, a later read of the active list does not bring the spinner back', async () => {
  let reads = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  server.use(
    http.get('/api/generations/active', async () => {
      reads += 1;
      if (reads > 1) await gate;
      return HttpResponse.json({ items: [] });
    }),
  );
  const { container, queryClient } = view(running);
  expect(await screen.findByText('Interrupted')).toBeInTheDocument();
  await act(async () => {
    void queryClient.invalidateQueries({ queryKey: qk.active });
    void queryClient.refetchQueries({ queryKey: qk.active });
    await new Promise((r) => setTimeout(r, 30));
  });
  expect(screen.getByText('Interrupted')).toBeInTheDocument();
  expect(container.querySelector('[class*="spinner"]')).toBeNull();
  release();
});
