import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { resetFakeSettings, setFakeSettings, updateSettings } from '../../test/fake-settings';
import { server } from '../../test/msw';
import { mockBackend, renderApp } from '../../test/renderApp';
import { conv, folder, serveSidebar, stubLayout } from '../../test/sidebar-backend';

vi.mock('../../state/settings', () => import('../../test/fake-settings'));

let restoreLayout: () => void;
beforeEach(() => {
  resetFakeSettings();
  mockBackend({ signedIn: true });
  restoreLayout = stubLayout();
});
afterEach(() => restoreLayout());

const recent = { id: 'recent', kind: 'recent', visible: true, collapsed: false, groupBy: 'date' };
const pinned = { id: 'pinned', kind: 'pinned', visible: false, collapsed: false };
const folders = { id: 'folders', kind: 'folders', visible: true, collapsed: false };

async function sectionHeadings(): Promise<string[]> {
  const nav = await screen.findByRole('navigation', { name: 'Chats' });
  await within(nav).findAllByRole('heading', { level: 2 });
  return within(nav)
    .getAllByRole('heading', { level: 2 })
    .map((h) => h.textContent ?? '');
}

test('sections follow settings order and visibility', async () => {
  setFakeSettings({ settings: { sidebar: { sections: [recent, pinned, folders] } } });
  serveSidebar();
  renderApp('/');
  await waitFor(async () => expect(await sectionHeadings()).toEqual(['Recent', 'Folders']));
  expect(screen.queryByRole('heading', { name: 'Pinned' })).not.toBeInTheDocument();
});

test('unknown section kinds are skipped and kept', async () => {
  const future = { id: 'later', kind: 'from-the-future', visible: true, collapsed: false, x: 1 };
  setFakeSettings({ settings: { sidebar: { sections: [future, recent] } } });
  serveSidebar();
  const { user } = renderApp('/');
  await waitFor(async () => expect(await sectionHeadings()).toEqual(['Recent']));
  await user.click(screen.getByRole('button', { name: 'Recent' }));
  const patch = updateSettings.mock.calls.at(-1)?.[0] as {
    sidebar: { sections: { id: string }[] };
  };
  expect(patch.sidebar.sections[0]).toMatchObject(future);
});

test('collapsing saves to settings', async () => {
  setFakeSettings({ settings: { sidebar: { sections: [folders, recent] } } });
  serveSidebar({ conversations: [conv(Date.now(), { title: 'Lab notes' })] });
  const { user } = renderApp('/');
  expect(await screen.findByRole('link', { name: 'Lab notes' })).toBeInTheDocument();
  const header = screen.getByRole('button', { name: 'Recent' });
  expect(header).toHaveAttribute('aria-expanded', 'true');
  await user.click(header);
  expect(updateSettings).toHaveBeenCalledWith({
    sidebar: {
      sections: [
        { ...folders, collapsed: false },
        { ...recent, collapsed: true },
      ],
    },
  });
  await waitFor(() =>
    expect(screen.queryByRole('link', { name: 'Lab notes' })).not.toBeInTheDocument(),
  );
  expect(screen.getByRole('button', { name: 'Recent' })).toHaveAttribute('aria-expanded', 'false');
});

test('recent chats are grouped by date and untitled chats read "New chat"', async () => {
  const day = 86_400_000;
  serveSidebar({
    conversations: [
      conv(Date.now(), { title: 'Thesis outline' }),
      conv(Date.now() - 1, { title: null, titleSource: 'none' }),
      conv(Date.now() - 40 * day, { title: 'Old notes' }),
    ],
  });
  renderApp('/');
  const nav = await screen.findByRole('navigation', { name: 'Chats' });
  expect(await within(nav).findByRole('link', { name: 'Thesis outline' })).toBeInTheDocument();
  expect(within(nav).getByRole('link', { name: 'New chat' })).toBeInTheDocument();
  expect(within(nav).getByText('Today')).toBeInTheDocument();
});

test('the open chat is marked and a running chat shows a spinner', async () => {
  const a = conv(Date.now(), { title: 'Thesis outline' });
  const b = conv(Date.now() - 1, { title: 'Lab notes' });
  serveSidebar({ conversations: [a, b], active: [{ id: 'gen_1', conversationId: b.id }] });
  renderApp(`/c/${a.id}`);
  const open = await screen.findByRole('link', { name: 'Thesis outline' });
  expect(open).toHaveAttribute('aria-current', 'page');
  const running = screen.getByRole('link', { name: 'Lab notes' });
  expect(running).not.toHaveAttribute('aria-current');
  expect(
    await within(running.closest('li') as HTMLElement).findByRole('status', {
      name: 'Writing a reply',
    }),
  ).toBeInTheDocument();
});

test('expanding a folder loads its chats', async () => {
  const f = folder({ id: 'fld_1', name: 'Thesis' });
  const inside = conv(Date.now(), { title: 'Chapter 2', folderId: f.id });
  const { calls } = serveSidebar({ folders: [f], conversations: [inside] });
  const { user } = renderApp('/');
  const toggle = await screen.findByRole('button', { name: 'Thesis' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('link', { name: 'Chapter 2' })).not.toBeInTheDocument();
  await user.click(toggle);
  expect(await screen.findByRole('link', { name: 'Chapter 2' })).toBeInTheDocument();
  expect(calls.some((c) => c.search.includes('scope=folder') && c.search.includes('fld_1'))).toBe(
    true,
  );
});

test('quick actions come from settings', async () => {
  setFakeSettings({ settings: { sidebar: { quickActions: ['search'] } } });
  serveSidebar();
  renderApp('/');
  expect(await screen.findByRole('button', { name: /Search/ })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'New chat' })).not.toBeInTheDocument();
});

test('a chat shown in two lists has a separate drag id in each', async () => {
  const f = folder({ id: 'fld_1', name: 'Thesis' });
  const c = conv(Date.now(), {
    title: 'Lab notes',
    pinned: true,
    pinPosition: 'a0',
    folderId: f.id,
  });
  serveSidebar({ folders: [f], conversations: [c] });
  const { user } = renderApp('/');
  await user.click(await screen.findByRole('button', { name: 'Thesis' }));
  await waitFor(() => expect(screen.getAllByRole('link', { name: 'Lab notes' })).toHaveLength(2));
  const ids = screen
    .getAllByRole('link', { name: 'Lab notes' })
    .map((a) => a.closest('li')?.getAttribute('data-drag-id'));
  expect(ids.every(Boolean)).toBe(true);
  expect(new Set(ids).size).toBe(2);
});

test('folder colors come from tokens, and marker yellow is not offered', async () => {
  const sky = folder({ id: 'fld_1', name: 'Thesis', color: '#A7D3F5' });
  const old = folder({ id: 'fld_2', name: 'Reading', color: '#FCE45C', position: 'a1' });
  serveSidebar({ folders: [sky, old] });
  const { user } = renderApp('/');
  const dot = (name: string) =>
    screen.getByRole('button', { name }).querySelector<HTMLElement>('[data-folder-dot]');
  await screen.findByRole('button', { name: 'Thesis' });
  expect(dot('Thesis')?.style.backgroundColor).toBe('var(--folder-sky)');
  expect(dot('Reading')?.style.backgroundColor).toBe('var(--folder-graphite)');
  await user.click(screen.getByRole('button', { name: 'Options for Thesis' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Color' }));
  expect(await screen.findByRole('menuitem', { name: 'Mint' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'Yellow' })).not.toBeInTheDocument();
});

test('the account menu offers Admin to admins only', async () => {
  serveSidebar();
  server.use(http.get('/api/admin/users', () => HttpResponse.json({ users: [] })));
  const { user, router } = renderApp('/');
  await user.click(await screen.findByRole('button', { name: 'Account menu for Ada' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Admin' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/admin/users'));
  expect(await screen.findByRole('heading', { level: 1, name: 'Users' })).toBeInTheDocument();
});

test('members see no Admin item and are sent away from the admin pages', async () => {
  serveSidebar();
  server.use(
    http.get('/api/auth/me', () =>
      HttpResponse.json({
        user: { id: 'u2', username: 'ben', displayName: 'Ben', role: 'member' },
      }),
    ),
  );
  const { user, router } = renderApp('/');
  await user.click(await screen.findByRole('button', { name: 'Account menu for Ben' }));
  expect(await screen.findByRole('menuitem', { name: 'Settings' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'Admin' })).not.toBeInTheDocument();
  await user.keyboard('{Escape}');
  await router.navigate({ to: '/admin/$section', params: { section: 'users' } });
  await waitFor(() => expect(router.state.location.pathname).toBe('/'));
});
