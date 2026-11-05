import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { setLocale } from '../../lib/i18n';
import { resetFakeSettings, setFakeSettings, updateSettings } from '../../test/fake-settings';
import { catalog, modelsResponse } from '../../test/model-fixtures';
import { server } from '../../test/msw';
import { mockBackend, renderApp } from '../../test/renderApp';
import { conv, serveSidebar, stubLayout } from '../../test/sidebar-backend';

vi.mock('../../state/settings', () => import('../../test/fake-settings'));

let restoreLayout: () => void;
beforeEach(() => {
  resetFakeSettings();
  mockBackend({ signedIn: true });
  server.use(
    http.get('/api/models', () => HttpResponse.json(modelsResponse(catalog))),
    http.get('/api/tools', () => HttpResponse.json({ tools: [], webSearchBackend: false })),
    // Settings pages opened from the palette load these.
    http.get('/api/providers', () => HttpResponse.json({ providers: [] })),
    http.get('/api/provider-presets', () => HttpResponse.json({ presets: [] })),
    http.get('/api/settings/history', () => HttpResponse.json({ items: [] })),
    // Focusing the message box warms the provider.
    http.post('/api/providers/:id/warm', () => new HttpResponse(null, { status: 204 })),
  );
  restoreLayout = stubLayout();
});
afterEach(() => {
  restoreLayout();
  vi.restoreAllMocks();
  setLocale('en');
});

const palette = () => screen.findByRole('dialog', { name: 'Command palette' });
const box = () => screen.findByRole('combobox', { name: 'Search chats, models and actions' });

async function openWithKeys(user: ReturnType<typeof renderApp>['user']) {
  await screen.findByRole('button', { name: /^Search/ });
  await user.keyboard('{Control>}k{/Control}');
  return palette();
}

test('Ctrl K opens it with the cursor in the search box, and Escape closes it', async () => {
  serveSidebar();
  const { user } = renderApp('/');
  const dialog = await openWithKeys(user);
  expect(await box()).toHaveFocus();
  expect(within(dialog).getByRole('group', { name: 'Actions' })).toBeInTheDocument();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('Ctrl K also opens it while typing in the composer, and a second press closes it', async () => {
  serveSidebar();
  const { user } = renderApp('/');
  await user.click(await screen.findByRole('textbox', { name: 'Message' }));
  await user.keyboard('{Control>}k{/Control}');
  await palette();
  await user.keyboard('{Control>}k{/Control}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('the sidebar Search button opens conversation search, not the palette', async () => {
  serveSidebar();
  const { user } = renderApp('/');
  const search = await screen.findByRole('button', { name: /^Search/ });
  expect(search).toBeEnabled();
  // The sidebar shows the search shortcut (Ctrl+Shift+F), not the palette's.
  expect(within(search).getByText('Shift')).toBeInTheDocument();
  expect(within(search).getByText('F')).toBeInTheDocument();
  await user.click(search);
  await screen.findByRole('dialog', { name: 'Search chats' });
  expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
});

test('typing filters the actions and Enter runs the first one', async () => {
  const c = conv(Date.now(), { title: 'Thesis outline' });
  serveSidebar({ conversations: [c] });
  const { user, router } = renderApp(`/c/${c.id}`);
  await openWithKeys(user);
  await user.type(await box(), 'new ch');
  const options = screen.getAllByRole('option');
  expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining('New chat')]);
  await user.keyboard('{Enter}');
  await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('settings sections are listed and open their page', async () => {
  serveSidebar();
  const { user, router } = renderApp('/');
  await openWithKeys(user);
  await user.type(await box(), 'appear');
  await user.click(screen.getByRole('option', { name: /Appearance/ }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/settings/appearance'));
});

test('switching the theme saves it', async () => {
  setFakeSettings({ settings: { appearance: { theme: 'light' } } });
  serveSidebar();
  const { user } = renderApp('/');
  await openWithKeys(user);
  await user.type(await box(), 'theme');
  // The theme already in use is not offered.
  expect(screen.queryByRole('option', { name: /light theme/i })).not.toBeInTheDocument();
  await user.click(screen.getByRole('option', { name: 'Switch to dark theme' }));
  expect(updateSettings).toHaveBeenLastCalledWith({ appearance: { theme: 'dark' } });
});

test('chats are found by title in the loaded list', async () => {
  const a = conv(Date.now(), { title: 'Thesis outline' });
  const b = conv(Date.now() - 1000, { title: 'Dinner ideas' });
  serveSidebar({ conversations: [a, b] });
  const { user, router } = renderApp('/');
  await screen.findByRole('link', { name: 'Thesis outline' });
  await user.keyboard('{Control>}k{/Control}');
  await user.type(await box(), 'thes');
  const group = await screen.findByRole('group', { name: 'Chats' });
  expect(within(group).getByRole('option', { name: /Thesis outline/ })).toBeInTheDocument();
  expect(within(group).queryByRole('option', { name: /Dinner ideas/ })).not.toBeInTheDocument();
  await user.click(within(group).getByRole('option', { name: /Thesis outline/ }));
  await waitFor(() => expect(router.state.location.pathname).toBe(`/c/${a.id}`));
});

test('older chats come from one debounced server search by title', async () => {
  const loaded = conv(Date.now(), { title: 'Weekly plan' });
  const old = conv(Date.now() - 9e9, { title: 'Plan for the lab move', archived: true });
  const { calls } = serveSidebar({ conversations: [loaded] });
  server.use(
    http.get('/api/conversations', ({ request }) => {
      const url = new URL(request.url);
      const needle = url.searchParams.get('titleContains');
      calls.push({ method: 'GET', path: url.pathname, search: url.search });
      if (needle) return HttpResponse.json({ items: [old], nextCursor: null });
      const recent = url.searchParams.get('scope') === 'recent';
      return HttpResponse.json({ items: recent ? [loaded] : [], nextCursor: null });
    }),
  );
  const { user, router } = renderApp('/');
  await screen.findByRole('link', { name: 'Weekly plan' });
  await user.keyboard('{Control>}k{/Control}');
  await user.type(await box(), 'lab');
  expect(await screen.findByRole('option', { name: /Plan for the lab move/ })).toBeInTheDocument();
  const searches = calls.filter((c) => c.search.includes('titleContains'));
  // One call for the word, not one per key.
  expect(searches).toHaveLength(1);
  const params = new URLSearchParams(searches[0]?.search);
  expect(params.get('titleContains')).toBe('lab');
  expect(params.get('scope')).toBe('all');
  await user.click(screen.getByRole('option', { name: /Plan for the lab move/ }));
  await waitFor(() => expect(router.state.location.pathname).toBe(`/c/${old.id}`));
});

test('a failed server search leaves the loaded chats usable', async () => {
  const loaded = conv(Date.now(), { title: 'Weekly plan' });
  serveSidebar({ conversations: [loaded] });
  server.use(
    http.get('/api/conversations', ({ request }) => {
      if (new URL(request.url).searchParams.get('titleContains')) {
        return HttpResponse.json(
          { error: { code: 'internal', message: 'Nope.' } },
          { status: 500 },
        );
      }
      const recent = new URL(request.url).searchParams.get('scope') === 'recent';
      return HttpResponse.json({ items: recent ? [loaded] : [], nextCursor: null });
    }),
  );
  const { user } = renderApp('/');
  await screen.findByRole('link', { name: 'Weekly plan' });
  await user.keyboard('{Control>}k{/Control}');
  await user.type(await box(), 'weekly');
  expect(await screen.findByRole('option', { name: /Weekly plan/ })).toBeInTheDocument();
});

test('models switch the model of the chat that is open', async () => {
  const c = conv(Date.now(), { title: 'Thesis outline' });
  serveSidebar({ conversations: [c] });
  const { user } = renderApp(`/c/${c.id}`);
  await screen.findByRole('heading', { level: 1, name: 'Thesis outline' });
  await user.keyboard('{Control>}k{/Control}');
  await user.type(await box(), 'acme');
  const group = await screen.findByRole('group', { name: 'Models' });
  await user.click(within(group).getByRole('option', { name: /Acme Free/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(await screen.findByRole('button', { name: 'Acme Free' })).toBeInTheDocument();
});

test('models are not offered where there is no chat to switch', async () => {
  serveSidebar();
  const { user } = renderApp('/settings/general');
  await screen.findByRole('heading', { level: 1, name: 'General' });
  await user.keyboard('{Control>}k{/Control}');
  await user.type(await box(), 'acme');
  expect(screen.queryByRole('group', { name: 'Models' })).not.toBeInTheDocument();
});

test('nothing matching says so', async () => {
  serveSidebar();
  const { user } = renderApp('/');
  await openWithKeys(user);
  await user.type(await box(), 'zzzzqq');
  expect(await screen.findByText('Nothing matches “zzzzqq”.')).toBeInTheDocument();
});

test('it speaks Indonesian when the language is set to it', async () => {
  setFakeSettings({ settings: { locale: 'id' } });
  serveSidebar();
  const { user } = renderApp('/');
  await screen.findByRole('link', { name: 'Obrolan baru' });
  await user.keyboard('{Control>}k{/Control}');
  expect(await screen.findByRole('dialog', { name: 'Palet perintah' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /Obrolan baru/ })).toBeInTheDocument();
});

test('the app shortcuts work: new chat, sidebar, message box, settings', async () => {
  const c = conv(Date.now(), { title: 'Thesis outline' });
  serveSidebar({ conversations: [c] });
  const { user, router } = renderApp(`/c/${c.id}`);
  await screen.findByRole('heading', { level: 1, name: 'Thesis outline' });

  await user.keyboard('{Control>}{Shift>}o{/Shift}{/Control}');
  await waitFor(() => expect(router.state.location.pathname).toBe('/'));

  await user.keyboard('{Control>}b{/Control}');
  expect(updateSettings).toHaveBeenLastCalledWith({ sidebar: { collapsed: true } });

  const composer = await screen.findByRole('textbox', { name: 'Message' });
  expect(composer).not.toHaveFocus();
  await user.keyboard('{Shift>}{Escape}{/Shift}');
  expect(composer).toHaveFocus();

  // user-event has no key code for punctuation, so these two are sent as the browser would.
  fireEvent.keyDown(document.body, { key: ',', code: 'Comma', ctrlKey: true });
  await waitFor(() => expect(router.state.location.pathname).toBe('/settings/general'));
  fireEvent.keyDown(document.body, { key: '/', code: 'Slash', ctrlKey: true });
  await waitFor(() => expect(router.state.location.pathname).toBe('/settings/shortcuts'));
});

test('a rebound shortcut replaces the default one', async () => {
  setFakeSettings({ settings: { shortcuts: { palette: '$mod+KeyP' } } });
  serveSidebar();
  const { user } = renderApp('/');
  await screen.findByRole('button', { name: /^Search/ });
  await user.keyboard('{Control>}k{/Control}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await user.keyboard('{Control>}p{/Control}');
  await palette();
});

test('shortcuts stay quiet on the sign-in page', async () => {
  mockBackend({ signedIn: false });
  const { user, router } = renderApp('/login');
  await screen.findByRole('button', { name: 'Sign in' });
  await user.keyboard('{Control>}k{/Control}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/login');
});

test('while Change is listening, the keys go to it and the palette stays shut', async () => {
  serveSidebar();
  const { user } = renderApp('/settings/shortcuts');
  const item = await screen.findByRole('listitem', { name: 'Open the command palette' });
  await user.click(within(item).getByRole('button', { name: 'Change' }));
  await user.keyboard('{Control>}k{/Control}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  // It is the palette's own chord, so nothing changes and listening ends.
  expect(updateSettings).toHaveBeenLastCalledWith({ shortcuts: { palette: null } });
  expect(screen.queryByText('Press the new keys, or Escape to cancel.')).not.toBeInTheDocument();
});

test('another action cannot take the palette chord, and the palette does not open', async () => {
  serveSidebar();
  const { user } = renderApp('/settings/shortcuts');
  const item = await screen.findByRole('listitem', { name: 'Start a new chat' });
  await user.click(within(item).getByRole('button', { name: 'Change' }));
  await user.keyboard('{Control>}k{/Control}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Ctrl+K is already used by');
});
