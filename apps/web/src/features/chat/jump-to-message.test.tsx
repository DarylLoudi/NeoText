import type { ConversationDetail } from '@neotext/shared';
import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { resetGenerations } from '../../state/generations';
import { msg, summary } from '../../test/chat-fixtures';
import { resetFakeSettings } from '../../test/fake-settings';
import { server } from '../../test/msw';
import { mockBackend, renderApp } from '../../test/renderApp';
import { stubLayout } from '../../test/sidebar-backend';

vi.mock('../../state/settings', () => import('../../test/fake-settings'));

let restoreLayout: () => void;
beforeEach(() => {
  resetFakeSettings();
  resetGenerations();
  mockBackend({ signedIn: true });
  restoreLayout = stubLayout();
});
afterEach(() => {
  restoreLayout();
  vi.restoreAllMocks();
});

const text = (t: string) => [{ type: 'text' as const, text: t }];
// u1 -> a1 (active, newest) and u1 -> a2 -> u3 -> a3 (an older branch).
const messages = [
  msg({ id: 'u1', role: 'user', parts: text('question'), createdAt: 1 }),
  msg({ id: 'a1', parentId: 'u1', parts: text('active answer'), createdAt: 9 }),
  msg({ id: 'a2', parentId: 'u1', parts: text('old branch answer'), createdAt: 2 }),
  msg({ id: 'u3', parentId: 'a2', role: 'user', parts: text('follow up'), createdAt: 3 }),
  msg({ id: 'a3', parentId: 'u3', parts: text('old branch end'), createdAt: 4 }),
];

function serve(activeLeafId: string) {
  const patches: unknown[] = [];
  const detail: ConversationDetail = {
    conversation: summary({ activeLeafId }),
    messages,
  };
  server.use(
    http.get('/api/conversations/cnv_1', () => HttpResponse.json(detail)),
    http.patch('/api/conversations/cnv_1', async ({ request }) => {
      const body = (await request.json()) as { activeLeafId: string };
      patches.push(body);
      detail.conversation = { ...detail.conversation, activeLeafId: body.activeLeafId };
      return HttpResponse.json(detail.conversation);
    }),
  );
  return patches;
}

test('?m= on another branch switches the active leaf to the newest one under it', async () => {
  const patches = serve('a1');
  renderApp('/c/cnv_1?m=a2');
  expect(await screen.findByText('old branch end')).toBeInTheDocument();
  expect(screen.queryByText('active answer')).not.toBeInTheDocument();
  await waitFor(() => expect(patches).toEqual([{ activeLeafId: 'a3' }]));
});

test('?m= on the visible path changes nothing', async () => {
  const patches = serve('a1');
  renderApp('/c/cnv_1?m=a1');
  expect(await screen.findByText('active answer')).toBeInTheDocument();
  await new Promise((r) => setTimeout(r, 50));
  expect(patches).toEqual([]);
});
