import { ListQuerySchema } from '@neotext/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test, vi } from 'vitest';
import { server } from '../../../test/msw';
import { renderWithClient } from '../../../test/renderWithClient';
import { conv } from '../../../test/sidebar-backend';
import { TrashPanel } from './TrashPanel';

const forget = vi.hoisted(() => vi.fn(async (_ids: string[]) => {}));
vi.mock('../../project/preview-storage', () => ({ forgetPreviewStorage: forget }));

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 3, 12, 0).getTime();

let items: ReturnType<typeof conv>[];
let calls: string[];
let nextCursor: string | null;

beforeEach(() => {
  vi.setSystemTime?.(NOW);
  calls = [];
  forget.mockClear();
  nextCursor = null;
  items = [
    conv(NOW - 10 * DAY, { title: 'Thesis plan', deletedAt: NOW - 10 * DAY }),
    conv(NOW - 2 * DAY, { title: 'Recipes', deletedAt: NOW - 2 * DAY }),
  ];
  server.use(
    http.get('/api/conversations', ({ request }) => {
      const params = new URL(request.url).searchParams;
      // Parsed as the server does, so a query it would refuse fails here too.
      expect(ListQuerySchema.parse(Object.fromEntries(params)).scope).toBe('trash');
      return HttpResponse.json({ items, nextCursor });
    }),
    http.post('/api/conversations/:id/restore', ({ params }) => {
      calls.push(`restore ${params.id}`);
      const found = items.find((i) => i.id === params.id);
      items = items.filter((i) => i.id !== params.id);
      return HttpResponse.json({ ...found, deletedAt: null });
    }),
    http.delete('/api/conversations/:id', ({ params, request }) => {
      calls.push(`delete ${params.id} ${new URL(request.url).searchParams.get('permanent')}`);
      items = items.filter((i) => i.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete('/api/trash', () => {
      calls.push('empty');
      const ids = items.map((i) => i.id);
      items = [];
      return HttpResponse.json({ purged: ids.length, ids });
    }),
  );
});

test('shows how many days are left for each chat', async () => {
  renderWithClient(<TrashPanel now={() => NOW} />);
  const rows = await screen.findAllByRole('listitem');
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent('Thesis plan');
  expect(rows[0]).toHaveTextContent('20 days left');
  expect(rows[1]).toHaveTextContent('28 days left');
});

test('restore and delete forever with confirmation', async () => {
  const { user, queryClient } = renderWithClient(<TrashPanel now={() => NOW} />);
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const rows = await screen.findAllByRole('listitem');
  const [first, second] = items;

  await user.click(within(rows[0] as HTMLElement).getByRole('button', { name: 'Restore' }));
  await waitFor(() => expect(calls).toEqual([`restore ${first?.id}`]));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['conversations'] });
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));

  await user.click(screen.getByRole('button', { name: 'Delete forever' }));
  const dialog = await screen.findByRole('dialog', { name: 'Delete this chat forever?' });
  expect(calls).toHaveLength(1);
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(calls).toHaveLength(1);

  await user.click(screen.getByRole('button', { name: 'Delete forever' }));
  const again = await screen.findByRole('dialog', { name: 'Delete this chat forever?' });
  await user.click(within(again).getByRole('button', { name: 'Delete forever' }));
  await waitFor(() => expect(calls).toEqual([`restore ${first?.id}`, `delete ${second?.id} 1`]));
  // What the chat's preview kept in this browser goes with it; a restored chat keeps it.
  await waitFor(() => expect(forget.mock.calls).toEqual([[[second?.id]]]));
  expect(await screen.findByText('Your trash is empty.')).toBeInTheDocument();
});

test('empty trash states the count and asks first', async () => {
  const items0 = [...items];
  const { user } = renderWithClient(<TrashPanel now={() => NOW} />);
  await screen.findAllByRole('listitem');
  await user.click(screen.getByRole('button', { name: 'Empty trash' }));
  const dialog = await screen.findByRole('dialog', { name: 'Empty the trash?' });
  expect(dialog).toHaveTextContent('2 chats');
  expect(calls).toEqual([]);
  await user.click(within(dialog).getByRole('button', { name: 'Empty trash' }));
  await waitFor(() => expect(calls).toEqual(['empty']));
  await waitFor(() => expect(forget.mock.calls).toEqual([[items0.map((i) => i.id)]]));
  expect(await screen.findByText('Your trash is empty.')).toBeInTheDocument();
});

test('empty trash says the count is a minimum when the list is capped', async () => {
  items = Array.from({ length: 100 }, (_, i) =>
    conv(NOW - DAY, { title: `Chat ${i}`, deletedAt: NOW - DAY }),
  );
  nextCursor = 'more';
  const { user } = renderWithClient(<TrashPanel now={() => NOW} />);
  await screen.findAllByRole('listitem');
  await user.click(screen.getByRole('button', { name: 'Empty trash' }));
  const dialog = await screen.findByRole('dialog', { name: 'Empty the trash?' });
  expect(dialog).toHaveTextContent('At least 100 chats');
});
