import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { resetFakeSettings } from '../../test/fake-settings';
import { server } from '../../test/msw';
import { mockBackend, renderApp } from '../../test/renderApp';
import { conv, folder, serveSidebar, stubLayout } from '../../test/sidebar-backend';
import { dismissToast, getToasts } from '../../ui/Toast/toastStore';

vi.mock('../../state/settings', () => import('../../test/fake-settings'));

let restoreLayout: () => void;
beforeEach(() => {
  resetFakeSettings();
  mockBackend({ signedIn: true });
  restoreLayout = stubLayout();
});
afterEach(() => {
  restoreLayout();
  for (const t of getToasts()) dismissToast(t.id);
});

async function openMenu(user: ReturnType<typeof renderApp>['user'], title: string) {
  await screen.findByRole('link', { name: title });
  await user.click(screen.getByRole('button', { name: `Options for ${title}` }));
  return screen.findByRole('menu');
}

test('delete offers undo', async () => {
  const c = conv(Date.now(), { title: 'Thesis outline' });
  const { calls } = serveSidebar({ conversations: [c] });
  const { user } = renderApp('/');
  const menu = await openMenu(user, 'Thesis outline');
  await user.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
  await waitFor(() =>
    expect(screen.queryByRole('link', { name: 'Thesis outline' })).not.toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(calls.some((x) => x.method === 'DELETE' && x.path.endsWith(c.id))).toBe(true),
  );
  expect(await screen.findByText('Chat moved to trash')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() =>
    expect(calls.some((x) => x.method === 'POST' && x.path.endsWith(`${c.id}/restore`))).toBe(true),
  );
  expect(await screen.findByRole('link', { name: 'Thesis outline' })).toBeInTheDocument();
});

test('a failed delete puts the row back and says so', async () => {
  const c = conv(Date.now(), { title: 'Thesis outline' });
  serveSidebar({ conversations: [c] });
  server.use(
    http.delete('/api/conversations/:id', () =>
      HttpResponse.json({ error: { code: 'internal', message: 'Disk full.' } }, { status: 500 }),
    ),
  );
  const { user } = renderApp('/');
  const menu = await openMenu(user, 'Thesis outline');
  await user.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
  expect(await screen.findByText('Disk full.')).toBeInTheDocument();
  expect(await screen.findByRole('link', { name: 'Thesis outline' })).toBeInTheDocument();
});

test('rename saves with Enter and cancels with Escape', async () => {
  const c = conv(Date.now(), { title: 'Thesis outline' });
  const { calls } = serveSidebar({ conversations: [c] });
  const { user } = renderApp('/');

  let menu = await openMenu(user, 'Thesis outline');
  await user.click(within(menu).getByRole('menuitem', { name: 'Rename' }));
  const input = await screen.findByRole('textbox', { name: 'Chat title' });
  expect(input).toHaveValue('Thesis outline');
  await user.clear(input);
  await user.type(input, 'Chapter 2 plan{Enter}');
  expect(await screen.findByRole('link', { name: 'Chapter 2 plan' })).toHaveFocus();
  await waitFor(() =>
    expect(calls.find((x) => x.method === 'PATCH')?.body).toEqual({ title: 'Chapter 2 plan' }),
  );

  menu = await openMenu(user, 'Chapter 2 plan');
  await user.click(within(menu).getByRole('menuitem', { name: 'Rename' }));
  const again = await screen.findByRole('textbox', { name: 'Chat title' });
  await user.type(again, ' draft{Escape}');
  expect(screen.queryByRole('textbox', { name: 'Chat title' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Chapter 2 plan' })).toHaveFocus();
  expect(calls.filter((x) => x.method === 'PATCH')).toHaveLength(1);
});

test('after a delete, focus moves to the next chat, or to the section heading', async () => {
  const a = conv(Date.now(), { title: 'Thesis outline' });
  const b = conv(Date.now() - 1, { title: 'Lab notes' });
  serveSidebar({ conversations: [a, b] });
  const { user } = renderApp('/');
  let menu = await openMenu(user, 'Thesis outline');
  await user.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
  await waitFor(() => expect(screen.getByRole('link', { name: 'Lab notes' })).toHaveFocus());
  menu = await openMenu(user, 'Lab notes');
  await user.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Recent' })).toHaveFocus());
});

test('pin assigns a position after the current last pinned', async () => {
  const first = conv(Date.now() - 10, { title: 'Lab notes', pinned: true, pinPosition: 'a0' });
  const second = conv(Date.now() - 20, { title: 'Reading list', pinned: true, pinPosition: 'a1' });
  const c = conv(Date.now(), { title: 'Thesis outline' });
  const { calls } = serveSidebar({ conversations: [first, second, c] });
  const { user } = renderApp('/');
  await screen.findByRole('link', { name: 'Reading list' });
  const menu = await openMenu(user, 'Thesis outline');
  await user.click(within(menu).getByRole('menuitem', { name: 'Pin' }));
  await waitFor(() =>
    expect(calls.find((x) => x.method === 'PATCH')?.body).toEqual({
      pinned: true,
      pinPosition: 'a2',
    }),
  );
  const pinnedList = await screen.findByRole('list', { name: 'Pinned' });
  await waitFor(() =>
    expect(
      within(pinnedList)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Lab notes', 'Reading list', 'Thesis outline']),
  );
});

test('a pinned chat moves up and down from its menu; the ends are disabled', async () => {
  const pins = ['Lab notes', 'Reading list', 'Thesis outline'].map((title, i) =>
    conv(Date.now() - i, { title, pinned: true, pinPosition: `a${i}` }),
  );
  const { calls } = serveSidebar({ conversations: pins });
  const { user } = renderApp('/');
  const pinnedList = await screen.findByRole('list', { name: 'Pinned' });
  const order = () =>
    within(pinnedList)
      .getAllByRole('link')
      .map((a) => a.textContent);

  let menu = await openMenu(user, 'Lab notes');
  expect(within(menu).getByRole('menuitem', { name: 'Move up' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await user.click(within(menu).getByRole('menuitem', { name: 'Move down' }));
  await waitFor(() => expect(order()).toEqual(['Reading list', 'Lab notes', 'Thesis outline']));
  const body = calls.find((x) => x.method === 'PATCH')?.body as { pinPosition: string };
  expect(body.pinPosition > 'a1' && body.pinPosition < 'a2').toBe(true);

  menu = await openMenu(user, 'Thesis outline');
  expect(within(menu).getByRole('menuitem', { name: 'Move down' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await user.click(within(menu).getByRole('menuitem', { name: 'Move up' }));
  await waitFor(() => expect(order()).toEqual(['Reading list', 'Thesis outline', 'Lab notes']));
});

test('a chat outside Pinned has no move up or down', async () => {
  serveSidebar({ conversations: [conv(Date.now(), { title: 'Thesis outline' })] });
  const { user } = renderApp('/');
  const menu = await openMenu(user, 'Thesis outline');
  expect(within(menu).queryByRole('menuitem', { name: 'Move up' })).not.toBeInTheDocument();
});

test('move to folder sends the folder id', async () => {
  const f = folder({ id: 'fld_1', name: 'Thesis' });
  const c = conv(Date.now(), { title: 'Chapter 2' });
  const { calls } = serveSidebar({ conversations: [c], folders: [f] });
  const { user } = renderApp('/');
  const menu = await openMenu(user, 'Chapter 2');
  await user.click(within(menu).getByRole('menuitem', { name: 'Move to folder' }));
  // Pointer travel into a submenu needs real layout; choose the folder with the keyboard.
  (await screen.findByRole('menuitem', { name: 'Thesis' })).focus();
  await user.keyboard('{Enter}');
  await waitFor(() =>
    expect(calls.find((x) => x.method === 'PATCH')?.body).toEqual({ folderId: 'fld_1' }),
  );
  await waitFor(() =>
    expect(screen.queryByRole('link', { name: 'Chapter 2' })).not.toBeInTheDocument(),
  );
});
