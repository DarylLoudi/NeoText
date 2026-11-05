import type { ConversationDetail, SearchResponse } from '@neotext/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { setLocale } from '../../lib/i18n';
import { msg, summary } from '../../test/chat-fixtures';
import { resetFakeSettings } from '../../test/fake-settings';
import { server } from '../../test/msw';
import { mockBackend, renderApp } from '../../test/renderApp';
import { serveSidebar, stubLayout } from '../../test/sidebar-backend';

vi.mock('../../state/settings', () => import('../../test/fake-settings'));

let restoreLayout: () => void;
let queries: URLSearchParams[] = [];
beforeEach(() => {
  resetFakeSettings();
  mockBackend({ signedIn: true });
  restoreLayout = stubLayout();
  queries = [];
});
afterEach(() => {
  restoreLayout();
  vi.restoreAllMocks();
  setLocale('en');
});

function serveSearch(pages: SearchResponse[]) {
  let call = 0;
  server.use(
    http.get('/api/search', ({ request }) => {
      queries.push(new URL(request.url).searchParams);
      const page = pages[Math.min(call, pages.length - 1)];
      call++;
      return HttpResponse.json(page);
    }),
  );
}

const hit = (over: Partial<SearchResponse['results'][number]> = {}) => ({
  conversationId: 'cnv_1',
  messageId: 'm2',
  title: 'Thesis outline help',
  snippet: 'a quick café note',
  matchedIn: 'message' as const,
  at: 5,
  ...over,
});

async function openSearch(user: ReturnType<typeof renderApp>['user']) {
  await user.click(await screen.findByRole('button', { name: /^Search/ }));
  return screen.findByRole('dialog', { name: 'Search chats' });
}

test('shows results and opens the message', async () => {
  serveSidebar();
  serveSearch([{ results: [hit()], nextCursor: null, partial: false }]);
  const detail: ConversationDetail = {
    conversation: summary({ activeLeafId: 'm2' }),
    messages: [
      msg({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }),
      msg({ id: 'm2', parentId: 'm1', parts: [{ type: 'text', text: 'a quick café note' }] }),
    ],
  };
  server.use(http.get('/api/conversations/cnv_1', () => HttpResponse.json(detail)));
  const { user, router } = renderApp('/');
  const dialog = await openSearch(user);
  await user.type(within(dialog).getByRole('searchbox', { name: 'Search your chats' }), 'cafe');
  const result = await within(dialog).findByRole('button', { name: /Thesis outline help/ });
  // Debounced: one request for the whole word, not one per key.
  expect(queries.map((q) => q.get('q'))).toEqual(['cafe']);
  expect(result.querySelector('mark')?.textContent).toBe('café');
  await user.click(result);
  await waitFor(() => expect(router.state.location.pathname).toBe('/c/cnv_1'));
  expect(router.state.location.search).toEqual({ m: 'm2' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('snippet html is literal', async () => {
  serveSidebar();
  serveSearch([
    { results: [hit({ snippet: '<b>x</b> bold', title: null })], nextCursor: null, partial: false },
  ]);
  const { user } = renderApp('/');
  const dialog = await openSearch(user);
  await user.type(within(dialog).getByRole('searchbox'), 'bold');
  const result = await within(dialog).findByRole('button', { name: /<b>x<\/b> bold/ });
  expect(result.querySelector('b')).toBeNull();
  expect(result).toHaveTextContent('<b>x</b> bold');
});

test('Search further continues with the cursor', async () => {
  serveSidebar();
  serveSearch([
    { results: [hit({ snippet: 'first needle' })], nextCursor: 'cur1', partial: true },
    {
      results: [hit({ messageId: 'm9', snippet: 'second needle' })],
      nextCursor: null,
      partial: false,
    },
  ]);
  const { user } = renderApp('/');
  const dialog = await openSearch(user);
  await user.type(within(dialog).getByRole('searchbox'), 'needle');
  await within(dialog).findByText(/first/);
  await user.click(within(dialog).getByRole('button', { name: 'Search further' }));
  await within(dialog).findByText(/second/);
  expect(within(dialog).getByText(/first/)).toBeInTheDocument();
  expect(queries.at(-1)?.get('cursor')).toBe('cur1');
  expect(within(dialog).queryByRole('button', { name: 'Search further' })).not.toBeInTheDocument();
});

test('Ctrl Shift F opens it, and short input does not search', async () => {
  serveSidebar();
  serveSearch([{ results: [], nextCursor: null, partial: false }]);
  const { user } = renderApp('/');
  await screen.findByRole('button', { name: /^Search/ });
  await user.keyboard('{Control>}{Shift>}f{/Shift}{/Control}');
  const dialog = await screen.findByRole('dialog', { name: 'Search chats' });
  await user.type(within(dialog).getByRole('searchbox'), 'a');
  expect(await within(dialog).findByText('Type at least 2 characters.')).toBeInTheDocument();
  await new Promise((r) => setTimeout(r, 300));
  expect(queries).toHaveLength(0);
});
