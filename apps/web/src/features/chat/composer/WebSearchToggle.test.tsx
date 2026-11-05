import type { ModelInfo } from '@neotext/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { closeUserPersistence, openUserPersistence } from '../../../lib/persist/db';
import { flushDrafts } from '../../../lib/persist/drafts';
import { createQueryClient, qk } from '../../../lib/query';
import { resetFakeSettings, setFakeSettings, updateSettings } from '../../../test/fake-settings';
import { deepseekFlash, modelInfo } from '../../../test/model-fixtures';
import { server } from '../../../test/msw';
import { TooltipProvider } from '../../../ui';
import { Composer, type ComposerStream } from './Composer';

vi.mock('../../../state/settings', () => import('../../../test/fake-settings'));

const searching = modelInfo({
  id: 'acme/searcher',
  name: 'Acme Searcher',
  supports: { tools: true, reasoning: null, structuredOutputs: null, webSearch: true },
});

let backend = false;
let toolUrls: string[] = [];
beforeEach(async () => {
  toolUrls = [];
  globalThis.indexedDB = new IDBFactory();
  await openUserPersistence('u1');
  resetFakeSettings();
  backend = false;
  server.use(
    http.get('/api/tools', ({ request }) => {
      toolUrls.push(new URL(request.url).search);
      return HttpResponse.json({ tools: [], webSearchBackend: backend });
    }),
    http.post('/api/providers/:id/warm', () => new HttpResponse(null, { status: 204 })),
  );
});
afterEach(async () => {
  await flushDrafts();
  closeUserPersistence();
});

const stream: ComposerStream = {
  send: vi.fn(async () => true),
  stop: vi.fn(),
  generating: false,
  ready: true,
};

function composer(model: ModelInfo, conversationId: string | null = null) {
  return (
    <TooltipProvider>
      <Composer conversationId={conversationId} model={model} stream={stream} />
    </TooltipProvider>
  );
}

function setup(model: ModelInfo) {
  vi.mocked(stream.send).mockClear();
  const queryClient = createQueryClient();
  const view = render(composer(model), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  const user = userEvent.setup();
  const box = () => screen.getByRole('textbox', { name: 'Message' });
  return { ...view, user, queryClient, stream, box };
}

const web = () => screen.queryByRole('button', { name: 'Web' });

test('offered only when available; choice goes into the request', async () => {
  const { user, stream, box } = setup(searching);
  expect(web()).toHaveAttribute('aria-pressed', 'false');
  await user.click(web() as HTMLElement);
  expect(web()).toHaveAttribute('aria-pressed', 'true');
  // A choice for this message only: the default lives in Tools settings.
  expect(updateSettings).not.toHaveBeenCalled();
  await user.type(box(), 'what is new in node{Enter}');
  expect(stream.send).toHaveBeenCalledWith(
    'what is new in node',
    expect.objectContaining({ webSearch: true }),
  );
  // After the send it is back to the default for the next message.
  await waitFor(() => expect(web()).toHaveAttribute('aria-pressed', 'false'));
  await user.type(box(), 'and in deno{Enter}');
  expect(stream.send).toHaveBeenLastCalledWith(
    'and in deno',
    expect.objectContaining({ webSearch: false }),
  );
  expect(updateSettings).not.toHaveBeenCalled();
});

test('the choice goes back to the default in another chat or when the default changes', async () => {
  const { user, rerender } = setup(searching);
  await user.click(web() as HTMLElement);
  expect(web()).toHaveAttribute('aria-pressed', 'true');
  rerender(composer(searching, 'cnv_other'));
  expect(web()).toHaveAttribute('aria-pressed', 'false');

  await user.click(web() as HTMLElement);
  expect(web()).toHaveAttribute('aria-pressed', 'true');
  // Another tab turns the default on, then off again: the default wins each time.
  act(() => setFakeSettings({ settings: { webSearch: { defaultOn: true } } }));
  expect(web()).toHaveAttribute('aria-pressed', 'true');
  act(() => setFakeSettings({ settings: { webSearch: { defaultOn: false } } }));
  expect(web()).toHaveAttribute('aria-pressed', 'false');
});

test('hidden when neither the model nor a search backend can search', async () => {
  const { user, stream, box, queryClient } = setup(deepseekFlash);
  // Asked the server, which has no search backend.
  await waitFor(() => expect(queryClient.getQueryState(qk.toolsMeta)?.status).toBe('success'));
  expect(web()).toBeNull();
  // Only the cheap form is asked for, which never connects to tool servers.
  expect(toolUrls).toEqual(['?only=meta']);
  // On by default in settings, but nothing can search: the request asks for no search.
  setFakeSettings({ settings: { webSearch: { defaultOn: true } } });
  await user.type(box(), 'halo{Enter}');
  expect(stream.send).toHaveBeenCalledWith('halo', expect.objectContaining({ webSearch: false }));
});

test('a search backend makes it available for any model', async () => {
  backend = true;
  setup(deepseekFlash);
  expect(await screen.findByRole('button', { name: 'Web' })).toBeInTheDocument();
});

test('starts from the default in settings', async () => {
  setFakeSettings({ settings: { webSearch: { defaultOn: true } } });
  const { user, stream, box } = setup(searching);
  expect(web()).toHaveAttribute('aria-pressed', 'true');
  await user.hover(web() as HTMLElement);
  expect((await screen.findAllByText('Search the web for this message')).length).toBeGreaterThan(0);
  await user.type(box(), 'halo{Enter}');
  expect(stream.send).toHaveBeenCalledWith('halo', expect.objectContaining({ webSearch: true }));
});

test('the tooltip names the configured engine and its price', async () => {
  setFakeSettings({ settings: { webSearch: { engine: 'exa', mode: 'deep' } } });
  const { user } = setup(searching);
  await user.hover(web() as HTMLElement);
  expect((await screen.findAllByText('Uses Exa (Deep): $0.012 per search')).length).toBeGreaterThan(
    0,
  );
});

test('the tooltip says a search provider does the searching for other models', async () => {
  backend = true;
  const { user } = setup(deepseekFlash);
  await user.hover(await screen.findByRole('button', { name: 'Web' }));
  expect((await screen.findAllByText('Uses your search provider')).length).toBeGreaterThan(0);
});

test('an engine without modes shows no mode in the tooltip, whatever mode is saved', async () => {
  setFakeSettings({ settings: { webSearch: { engine: 'perplexity', mode: 'fast' } } });
  const { user } = setup(searching);
  await user.hover(web() as HTMLElement);
  expect((await screen.findAllByText('Uses Perplexity: $0.005 per search')).length).toBeGreaterThan(
    0,
  );
});
