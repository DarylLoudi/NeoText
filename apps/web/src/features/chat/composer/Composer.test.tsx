import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '../../../lib/api/client';
import { closeUserPersistence, openUserPersistence } from '../../../lib/persist/db';
import { flushDrafts, loadDraft } from '../../../lib/persist/drafts';
import { createQueryClient } from '../../../lib/query';
import { resetFakeSettings, setFakeSettings } from '../../../test/fake-settings';
import { deepseek, deepseekFlash } from '../../../test/model-fixtures';
import { server } from '../../../test/msw';
import { TooltipProvider } from '../../../ui';
import { dismissToast, getToasts } from '../../../ui/Toast/toastStore';
import { Composer, type ComposerStream } from './Composer';
import { resetWarmThrottle } from './warm';

vi.mock('../../../state/settings', () => import('../../../test/fake-settings'));
// No search backend, answered without the network so no request outlives a test.
vi.mock('../../../lib/api/tools', () => ({
  toolsApi: {
    list: async () => ({ tools: [], webSearchBackend: false }),
    meta: async () => ({ tools: [], webSearchBackend: false }),
  },
}));

let queryClient = createQueryClient();
function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}

let warmed: string[] = [];
beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  await openUserPersistence('u1');
  resetFakeSettings();
  resetWarmThrottle();
  for (const item of getToasts()) dismissToast(item.id);
  warmed = [];
  queryClient = createQueryClient();
  server.use(
    http.post('/api/providers/:id/warm', ({ params }) => {
      warmed.push(String(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
  );
});
afterEach(async () => {
  await flushDrafts();
  closeUserPersistence();
  vi.useRealTimers();
});

function stream(over: Partial<ComposerStream> = {}): ComposerStream {
  return {
    send: vi.fn(async () => true),
    stop: vi.fn(),
    generating: false,
    ready: true,
    ...over,
  };
}

function setup(s: ComposerStream = stream(), props: { conversationId?: string | null } = {}) {
  const ui = (st: ComposerStream) => (
    <Providers>
      <Composer conversationId={props.conversationId ?? null} model={deepseekFlash} stream={st} />
    </Providers>
  );
  const view = render(ui(s));
  const user = userEvent.setup();
  const box = () => screen.getByRole('textbox', { name: 'Message' });
  return { s, user, box, view, rerender: (st: ComposerStream) => view.rerender(ui(st)) };
}

test('Enter sends, Shift+Enter makes a newline', async () => {
  const { s, user, box } = setup();
  await user.type(box(), 'halo{Shift>}{Enter}{/Shift}dunia');
  expect(s.send).not.toHaveBeenCalled();
  expect(box()).toHaveValue('halo\ndunia');
  await user.keyboard('{Enter}');
  expect(s.send).toHaveBeenCalledTimes(1);
  expect(s.send).toHaveBeenCalledWith(
    'halo\ndunia',
    expect.objectContaining({ targets: [{ providerId: 'prv_1', modelId: deepseekFlash.id }] }),
  );
});

test('Enter sends the text as typed', async () => {
  const { s, user, box } = setup();
  await user.type(box(), 'halo{Enter}');
  expect(s.send).toHaveBeenCalledWith('halo', expect.anything());
});

/** A phone or tablet: the primary pointer is a finger. */
function touchScreen(): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('pointer: coarse'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

test('on a touch screen Enter makes a newline and only the Send button sends', async () => {
  touchScreen();
  const { s, user, box } = setup();
  await user.type(box(), 'halo{Enter}dunia');
  expect(s.send).not.toHaveBeenCalled();
  expect(box()).toHaveValue('halo\ndunia');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  expect(s.send).toHaveBeenCalledWith('halo\ndunia', expect.anything());
  vi.mocked(window.matchMedia).mockRestore();
});

test('mod-enter mode: Enter makes a newline, Ctrl+Enter sends', async () => {
  setFakeSettings({ settings: { chat: { sendKey: 'mod-enter' } } });
  const { s, user, box } = setup();
  await user.type(box(), 'halo{Enter}');
  expect(s.send).not.toHaveBeenCalled();
  expect(box()).toHaveValue('halo\n');
  await user.keyboard('{Control>}{Enter}{/Control}');
  expect(s.send).toHaveBeenCalledWith('halo', expect.anything());
});

test('mod-enter mode: Cmd+Enter sends too', async () => {
  setFakeSettings({ settings: { chat: { sendKey: 'mod-enter' } } });
  const { s, user, box } = setup();
  await user.type(box(), 'halo{Meta>}{Enter}{/Meta}');
  expect(s.send).toHaveBeenCalledTimes(1);
});

test('does not send during IME composition', async () => {
  const { s, user, box } = setup();
  await user.type(box(), 'nihon');
  fireEvent.keyDown(box(), { key: 'Enter', isComposing: true });
  fireEvent.keyDown(box(), { key: 'Enter', keyCode: 229 });
  expect(s.send).not.toHaveBeenCalled();
  expect(box()).toHaveValue('nihon');
  fireEvent.keyDown(box(), { key: 'Enter' });
  expect(s.send).toHaveBeenCalledTimes(1);
});

test('does not send during IME composition in mod-enter mode either', async () => {
  setFakeSettings({ settings: { chat: { sendKey: 'mod-enter' } } });
  const { s, user, box } = setup();
  await user.type(box(), 'nihon');
  fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true, isComposing: true });
  expect(s.send).not.toHaveBeenCalled();
});

test('blank text cannot be sent', async () => {
  const { s, user, box } = setup();
  const send = screen.getByRole('button', { name: 'Send message' });
  expect(send).toHaveAttribute('title', 'Send (Enter)');
  expect(send).toBeDisabled();
  await user.type(box(), '   {Enter}');
  await user.keyboard('{Shift>}{Enter}{/Shift}{Enter}');
  expect(s.send).not.toHaveBeenCalled();
  expect(send).toBeDisabled();
  await user.type(box(), 'x');
  expect(send).toBeEnabled();
  await user.click(send);
  expect(s.send).toHaveBeenCalledWith(expect.stringContaining('x'), expect.anything());
});

test('without a model the message can be typed but not sent', async () => {
  const s = stream();
  render(
    <Providers>
      <Composer conversationId={null} model={null} stream={s} />
    </Providers>,
  );
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox', { name: 'Message' }), 'halo{Enter}');
  expect(s.send).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
});

test('nothing can be sent until the chat has loaded', async () => {
  const { user, box, rerender } = setup(stream({ ready: false }), { conversationId: 'cnv_1' });
  const waiting = stream({ ready: false });
  rerender(waiting);
  await user.type(box(), 'halo{Enter}');
  const send = screen.getByRole('button', { name: 'Send message' });
  expect(send).toBeDisabled();
  fireEvent.submit(send.closest('form') as HTMLFormElement);
  expect(waiting.send).not.toHaveBeenCalled();
  expect(box()).toHaveValue('halo');
  const loaded = stream();
  rerender(loaded);
  expect(send).toBeEnabled();
  await user.keyboard('{Enter}');
  expect(loaded.send).toHaveBeenCalledWith('halo', expect.anything());
});

test('the text is cleared once the turn started, and so is its draft', async () => {
  const { user, box } = setup();
  await user.type(box(), 'halo{Enter}');
  await waitFor(() => expect(box()).toHaveValue(''));
  await flushDrafts();
  expect(await loadDraft('new')).toBe('');
});

test('draft is restored after remount and cleared after sending', async () => {
  const first = setup(stream(), { conversationId: 'cnv_1' });
  await first.user.type(first.box(), 'unfinished thought');
  await flushDrafts();
  first.view.unmount();

  const second = setup(stream(), { conversationId: 'cnv_1' });
  await waitFor(() => expect(second.box()).toHaveValue('unfinished thought'));
  second.view.unmount();
  // Another chat has its own draft.
  const other = setup(stream(), { conversationId: 'cnv_2' });
  await new Promise((r) => setTimeout(r, 20));
  expect(other.box()).toHaveValue('');
  other.view.unmount();

  const third = setup(stream(), { conversationId: 'cnv_1' });
  await waitFor(() => expect(third.box()).toHaveValue('unfinished thought'));
  await third.user.type(third.box(), '{Enter}');
  await waitFor(() => expect(third.box()).toHaveValue(''));
  await flushDrafts();
  expect(await loadDraft('cnv_1')).toBe('');
  third.view.unmount();
  const fourth = setup(stream(), { conversationId: 'cnv_1' });
  await new Promise((r) => setTimeout(r, 20));
  expect(fourth.box()).toHaveValue('');
});

test('a stored draft does not overwrite what was typed while it loaded', async () => {
  const seed = setup(stream(), { conversationId: 'cnv_9' });
  await seed.user.type(seed.box(), 'old draft');
  await flushDrafts();
  seed.view.unmount();

  const { box } = setup(stream(), { conversationId: 'cnv_9' });
  // Typed at once, before IndexedDB has answered.
  fireEvent.change(box(), { target: { value: 'N' } });
  await new Promise((r) => setTimeout(r, 30));
  expect(box()).toHaveValue('N');
});

test('a failed send keeps the text and shows the error', async () => {
  const s = stream({
    send: vi.fn(async () => {
      throw new ApiError('rate_limited', 'Too many requests. Wait a moment, then send again.', 429);
    }),
  });
  const { user, box } = setup(s);
  await user.type(box(), 'halo{Enter}');
  await waitFor(() =>
    expect(getToasts().map((t) => t.message)).toContain(
      'Too many requests. Wait a moment, then send again.',
    ),
  );
  expect(box()).toHaveValue('halo');
  expect(getToasts().at(-1)?.tone).toBe('danger');
  await flushDrafts();
  expect(await loadDraft('new')).toBe('halo');
});

test('a send that was ignored keeps the text', async () => {
  const s = stream({ send: vi.fn(async () => false) });
  const { user, box } = setup(s);
  await user.type(box(), 'halo{Enter}');
  await waitFor(() => expect(s.send).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 20));
  expect(box()).toHaveValue('halo');
});

test('text typed while the turn was starting is kept', async () => {
  let accept: (v: boolean) => void = () => {};
  const s = stream({ send: vi.fn(() => new Promise<boolean>((r) => (accept = r))) });
  const { user, box } = setup(s);
  await user.type(box(), 'halo{Enter}');
  await user.type(box(), ' dan lagi');
  accept(true);
  await new Promise((r) => setTimeout(r, 20));
  expect(box()).toHaveValue('halo dan lagi');
});

test('a second Enter while the first send is pending sends once', async () => {
  const s = stream({ send: vi.fn(() => new Promise<boolean>(() => {})) });
  const { user, box } = setup(s);
  await user.type(box(), 'halo{Enter}{Enter}');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  expect(s.send).toHaveBeenCalledTimes(1);
});

test('stop replaces send while generating; Escape stops', async () => {
  const s = stream({ generating: true });
  const { user, box } = setup(s);
  expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Stop generating' }));
  expect(s.stop).toHaveBeenCalledTimes(1);
  await user.click(box());
  await user.keyboard('{Escape}');
  expect(s.stop).toHaveBeenCalledTimes(2);
});

test('Enter does not send while generating, and Escape does nothing when idle', async () => {
  const s = stream({ generating: true });
  const { user, box } = setup(s);
  await user.type(box(), 'next question{Enter}');
  expect(s.send).not.toHaveBeenCalled();
  expect(box()).toHaveValue('next question');
});

test('Escape does nothing when idle', async () => {
  const { s, user, box } = setup();
  await user.type(box(), '{Escape}');
  expect(s.stop).not.toHaveBeenCalled();
});

test('the same control becomes Stop and back', () => {
  const { rerender } = setup(stream());
  expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument();
  rerender(stream({ generating: true }));
  expect(screen.getByRole('button', { name: 'Stop generating' })).toBeInTheDocument();
  rerender(stream());
  expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument();
});

test('focus warms the provider, at most once a minute', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: 1_000_000 });
  const { box } = setup();
  fireEvent.focus(box());
  await waitFor(() => expect(warmed).toEqual(['prv_1']));
  fireEvent.blur(box());
  vi.setSystemTime(1_000_000 + 59_000);
  fireEvent.focus(box());
  await new Promise((r) => setTimeout(r, 20));
  expect(warmed).toEqual(['prv_1']);
  vi.setSystemTime(1_000_000 + 61_000);
  fireEvent.focus(box());
  await waitFor(() => expect(warmed).toEqual(['prv_1', 'prv_1']));
});

test('a failed warm is silent', async () => {
  server.use(http.post('/api/providers/:id/warm', () => HttpResponse.error()));
  const { box } = setup();
  fireEvent.focus(box());
  await new Promise((r) => setTimeout(r, 30));
  expect(getToasts().filter((t) => t.tone === 'danger')).toEqual([]);
});

test('the reasoning choice is hidden for a model without reasoning and sent for one with', async () => {
  const flash = setup();
  expect(screen.queryByRole('combobox', { name: 'Reasoning' })).not.toBeInTheDocument();
  await flash.user.type(flash.box(), 'x{Enter}');
  expect(flash.s.send).toHaveBeenCalledWith(
    'x',
    expect.objectContaining({ reasoningEffort: null }),
  );
  flash.view.unmount();

  const s = stream();
  render(
    <Providers>
      <Composer conversationId={null} model={deepseek} stream={s} />
    </Providers>,
  );
  const user = userEvent.setup();
  const select = screen.getByRole('combobox', { name: 'Reasoning' });
  expect(select).toHaveTextContent('Auto');
  await user.click(select);
  await user.click(await screen.findByRole('option', { name: 'High' }));
  await user.type(screen.getByRole('textbox', { name: 'Message' }), 'x{Enter}');
  expect(s.send).toHaveBeenCalledWith('x', expect.objectContaining({ reasoningEffort: 'high' }));
});

test('the default effort from settings is used when the model offers it', () => {
  setFakeSettings({ settings: { chat: { reasoningEffort: 'low' } } });
  render(
    <Providers>
      <Composer conversationId={null} model={deepseek} stream={stream()} />
    </Providers>,
  );
  expect(screen.getByRole('combobox', { name: 'Reasoning' })).toHaveTextContent('Low');
});

test('the placeholder names the model', () => {
  setup();
  expect(screen.getByPlaceholderText('Message DeepSeek V4.1 Flash')).toBeInTheDocument();
});

const SNIPPETS = [
  { id: '1', trigger: 'sum', title: 'Summarise', body: 'Summarise this briefly.' },
  { id: '2', trigger: 'tr', title: 'Translate', body: 'Translate to {{language}}' },
];

test('snippet menu open: Enter inserts the snippet and does not send', async () => {
  setFakeSettings({ settings: { snippets: SNIPPETS } });
  const { s, user, box } = setup();
  await user.type(box(), '/su');
  await user.keyboard('{Enter}');
  expect(box()).toHaveValue('Summarise this briefly.');
  expect(s.send).not.toHaveBeenCalled();
});

test('snippet menu closed: Enter still sends', async () => {
  setFakeSettings({ settings: { snippets: SNIPPETS } });
  const { s, user, box } = setup();
  await user.type(box(), 'hello{Enter}');
  expect(s.send).toHaveBeenCalledWith('hello', expect.anything());
});

test('snippet variables dialog: Insert fills the text and does not send', async () => {
  setFakeSettings({ settings: { snippets: SNIPPETS } });
  const { s, user, box } = setup();
  await user.type(box(), '/tr{Enter}');
  await user.type(screen.getByRole('textbox', { name: 'language' }), 'French');
  await user.click(screen.getByRole('button', { name: 'Insert' }));
  await waitFor(() => expect(box()).toHaveValue('Translate to French'));
  expect(s.send).not.toHaveBeenCalled();
});

test('snippet variables dialog: Escape closes it and does not stop the answer', async () => {
  setFakeSettings({ settings: { snippets: SNIPPETS } });
  const s = stream({ generating: true });
  const { user, box } = setup(s);
  await user.type(box(), '/tr{Enter}');
  await user.type(screen.getByRole('textbox', { name: 'language' }), '{Escape}');
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'language' })).toBeNull());
  expect(s.stop).not.toHaveBeenCalled();
});

test('mod-enter mode: Ctrl+Enter with the snippet menu open sends', async () => {
  setFakeSettings({ settings: { chat: { sendKey: 'mod-enter' }, snippets: SNIPPETS } });
  const { s, user, box } = setup();
  await user.type(box(), '/su{Control>}{Enter}{/Control}');
  expect(s.send).toHaveBeenCalledWith('/su', expect.anything());
});

test('the snippet menu closes when the box loses focus', async () => {
  setFakeSettings({ settings: { snippets: SNIPPETS } });
  const { user, box } = setup();
  await user.type(box(), '/su');
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  expect(screen.getByLabelText('Message')).toHaveAttribute('role', 'combobox');
  await user.click(document.body);
  expect(screen.queryByRole('listbox')).toBeNull();
});
