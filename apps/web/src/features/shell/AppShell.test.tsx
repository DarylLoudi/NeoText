import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { setLocale } from '../../lib/i18n';
import { resetFakeSettings, setFakeSettings, updateSettings } from '../../test/fake-settings';
import { server } from '../../test/msw';
import { mockBackend, renderApp } from '../../test/renderApp';
import { conv, serveSidebar, stubLayout } from '../../test/sidebar-backend';

vi.mock('../../state/settings', () => import('../../test/fake-settings'));

let restoreLayout: () => void;
beforeEach(() => {
  resetFakeSettings();
  mockBackend({ signedIn: true });
  restoreLayout = stubLayout();
});
afterEach(() => {
  restoreLayout();
  vi.restoreAllMocks();
  setLocale('en');
});

const shell = () => document.querySelector<HTMLElement>('[data-sidebar-position]');

function narrowScreen(): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('max-width'),
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

test('applies width, position and collapsed state', async () => {
  setFakeSettings({ settings: { sidebar: { width: 320, position: 'right', collapsed: true } } });
  serveSidebar();
  renderApp('/');
  await waitFor(() => expect(shell()).not.toBeNull());
  const el = shell() as HTMLElement;
  expect(el.style.getPropertyValue('--sidebar-width')).toBe('320px');
  expect(el).toHaveAttribute('data-sidebar-position', 'right');
  expect(el).toHaveAttribute('data-sidebar-collapsed', 'true');
  expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeInTheDocument();
});

test('the top bar toggle saves the collapsed state', async () => {
  serveSidebar();
  const { user } = renderApp('/');
  await user.click(await screen.findByRole('button', { name: 'Collapse sidebar' }));
  expect(updateSettings).toHaveBeenCalledWith({ sidebar: { collapsed: true } });
  expect(shell()).toHaveAttribute('data-sidebar-collapsed', 'true');
});

test('recovered settings show the banner', async () => {
  setFakeSettings({ recovered: true });
  serveSidebar();
  renderApp('/');
  expect(
    await screen.findByText(
      "Some saved settings couldn't be read, so defaults were used. Restore a previous version in Settings → Data.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open data settings' })).toHaveAttribute(
    'href',
    '/settings/data',
  );
});

test('reset paths show the banner too, and a clean state shows none', async () => {
  serveSidebar();
  renderApp('/');
  await screen.findByRole('button', { name: 'Collapse sidebar' });
  expect(screen.queryByRole('link', { name: 'Open data settings' })).not.toBeInTheDocument();
  setFakeSettings({ resetPaths: ['sidebar.width'] });
  expect(await screen.findByRole('link', { name: 'Open data settings' })).toBeInTheDocument();
});

test('the resizer moves with arrow keys and saves on release', async () => {
  serveSidebar();
  renderApp('/');
  const handle = await screen.findByRole('separator', { name: 'Resize sidebar' });
  expect(handle).toHaveAttribute('aria-valuenow', '288');
  fireEvent.keyDown(handle, { key: 'ArrowRight' });
  fireEvent.keyDown(handle, { key: 'ArrowRight' });
  expect(handle).toHaveAttribute('aria-valuenow', '320');
  expect(updateSettings).not.toHaveBeenCalled();
  fireEvent.keyUp(handle, { key: 'ArrowRight' });
  expect(updateSettings).toHaveBeenCalledWith({ sidebar: { width: 320 } });
  fireEvent.keyDown(handle, { key: 'End' });
  fireEvent.keyUp(handle, { key: 'End' });
  expect(updateSettings).toHaveBeenLastCalledWith({ sidebar: { width: 420 } });
});

test('on a narrow screen the sidebar is a drawer opened from the top bar', async () => {
  narrowScreen();
  const c = conv(Date.now(), { title: 'Thesis outline' });
  serveSidebar({ conversations: [c] });
  const { user, router } = renderApp('/');
  await waitFor(() => expect(shell()).toHaveAttribute('data-drawer', 'closed'));
  const toggle = screen.getByRole('button', { name: 'Open sidebar' });
  expect(toggle.closest('[inert]')).toBeNull();
  await user.click(toggle);
  expect(shell()).toHaveAttribute('data-drawer', 'open');
  // The page behind the drawer is out of the tab order while it is open.
  expect(toggle.closest('[inert]')).not.toBeNull();
  expect(updateSettings).not.toHaveBeenCalled();
  await user.keyboard('{Escape}');
  expect(shell()).toHaveAttribute('data-drawer', 'closed');
  expect(toggle).toHaveFocus();

  await user.click(screen.getByRole('button', { name: 'Open sidebar' }));
  await user.click(await screen.findByRole('link', { name: 'Thesis outline' }));
  await waitFor(() => expect(router.state.location.pathname).toBe(`/c/${c.id}`));
  expect(shell()).toHaveAttribute('data-drawer', 'closed');
});

test('the conversation title in the top bar can be renamed', async () => {
  const c = conv(Date.now(), { title: 'Thesis outline' });
  const { calls } = serveSidebar({ conversations: [c] });
  server.use(
    http.get('/api/conversations/:id', () => HttpResponse.json({ conversation: c, messages: [] })),
  );
  const { user } = renderApp(`/c/${c.id}`);
  const heading = await screen.findByRole('heading', { level: 1, name: 'Thesis outline' });
  const title = within(heading).getByRole('button', { name: 'Thesis outline' });
  expect(title).toHaveAccessibleDescription('Rename this chat');
  await user.click(title);
  const input = screen.getByRole('textbox', { name: 'Chat title' });
  await user.clear(input);
  await user.type(input, 'Chapter 2{Enter}');
  await waitFor(() =>
    expect(calls.find((x) => x.method === 'PATCH')?.body).toEqual({ title: 'Chapter 2' }),
  );
  expect(await screen.findByRole('heading', { level: 1, name: 'Chapter 2' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Chapter 2' })).toHaveFocus();
});

test('the top bar menu exports the open chat as Markdown', async () => {
  const c = conv(Date.now(), { title: 'Thesis outline' });
  serveSidebar({ conversations: [c] });
  const bodies: unknown[] = [];
  server.use(
    http.get('/api/conversations/:id', () => HttpResponse.json({ conversation: c, messages: [] })),
    http.post('/api/export', async ({ request }) => {
      bodies.push(await request.json());
      return new HttpResponse('# Thesis outline\n', {
        headers: {
          'content-type': 'text/markdown; charset=utf-8',
          'content-disposition': `attachment; filename="Thesis outline.md"; filename*=UTF-8''Thesis%20outline.md`,
        },
      });
    }),
  );
  URL.createObjectURL = vi.fn(() => 'blob:chat');
  URL.revokeObjectURL = vi.fn();
  const names: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download);
  });
  const { user } = renderApp(`/c/${c.id}`);
  await user.click(await screen.findByRole('button', { name: 'More actions' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Export this chat' }));
  await waitFor(() => expect(names).toEqual(['Thesis outline.md']));
  expect(bodies).toEqual([{ format: 'markdown', conversationId: c.id }]);
  expect(await screen.findByText('Chat exported as Markdown')).toBeInTheDocument();
});

test('sign out ends the session and opens the sign-in page', async () => {
  let loggedOut = false;
  serveSidebar();
  server.use(
    http.post('/api/auth/logout', () => {
      loggedOut = true;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const { user, router } = renderApp('/');
  await user.click(await screen.findByRole('button', { name: 'Account menu for Ada' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  expect(loggedOut).toBe(true);
});

test('the shell follows the language setting', async () => {
  setFakeSettings({ settings: { locale: 'id' } });
  serveSidebar();
  renderApp('/');
  expect(await screen.findByRole('link', { name: 'Obrolan baru' })).toBeInTheDocument();
});
