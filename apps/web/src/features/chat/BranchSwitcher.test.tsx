import type { ConversationDetail } from '@neotext/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, expect, test } from 'vitest';
import { createQueryClient, qk } from '../../lib/query';
import { msg, summary } from '../../test/chat-fixtures';
import { server } from '../../test/msw';
import { TooltipProvider } from '../../ui';
import { dismissToast, getToasts } from '../../ui/Toast/toastStore';
import { BranchSwitcher } from './BranchSwitcher';

afterEach(() => {
  for (const t of getToasts()) dismissToast(t.id);
});

// u1 ─┬─ a1
//     └─ a2 ── u2 ── a3
const messages = [
  msg({ id: 'u1', role: 'user', createdAt: 1 }),
  msg({ id: 'a1', parentId: 'u1', createdAt: 2 }),
  msg({ id: 'a2', parentId: 'u1', createdAt: 3 }),
  msg({ id: 'u2', role: 'user', parentId: 'a2', createdAt: 4 }),
  msg({ id: 'a3', parentId: 'u2', createdAt: 5 }),
];

function setup(index: number) {
  const qc = createQueryClient();
  const detail: ConversationDetail = {
    conversation: summary({ activeLeafId: index === 0 ? 'a1' : 'a3' }),
    messages,
  };
  qc.setQueryData(qk.conversation('cnv_1'), detail);
  render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <BranchSwitcher conversationId="cnv_1" siblingIds={['a1', 'a2']} index={index} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  const leaf = () =>
    qc.getQueryData<ConversationDetail>(qk.conversation('cnv_1'))?.conversation.activeLeafId;
  return { leaf, user: userEvent.setup() };
}

test('next updates the active leaf', async () => {
  const bodies: unknown[] = [];
  server.use(
    http.patch('/api/conversations/:id', async ({ request }) => {
      const body = await request.json();
      bodies.push(body);
      return HttpResponse.json(summary({ activeLeafId: 'a3' }));
    }),
  );
  const { leaf, user } = setup(0);
  expect(screen.getByText('1 / 2')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Previous version' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Next version' }));
  expect(leaf()).toBe('a3');
  await waitFor(() => expect(bodies).toEqual([{ activeLeafId: 'a3' }]));
});

test('a failed switch goes back and says so', async () => {
  server.use(
    http.patch('/api/conversations/:id', () =>
      HttpResponse.json({ error: { code: 'internal', message: 'Disk full.' } }, { status: 500 }),
    ),
  );
  const { leaf, user } = setup(1);
  expect(screen.getByRole('button', { name: 'Next version' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Previous version' }));
  await waitFor(() => expect(getToasts().map((t) => t.message)).toEqual(['Disk full.']));
  expect(leaf()).toBe('a3');
});
