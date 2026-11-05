import { act, screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '../../lib/api/client';
import {
  onSettingsRejected,
  resetFakeSettings,
  setFakeSettings,
  updateSettings,
} from '../../test/fake-settings';
import { server } from '../../test/msw';
import { mockBackend, renderApp } from '../../test/renderApp';

vi.mock('../../state/settings', () => import('../../test/fake-settings'));

beforeEach(() => {
  resetFakeSettings();
  mockBackend({ signedIn: true });
  server.use(
    http.get('/api/providers', () => HttpResponse.json({ providers: [] })),
    http.get('/api/provider-presets', () => HttpResponse.json({ presets: [] })),
    http.get('/api/settings/history', () => HttpResponse.json({ items: [] })),
  );
});

test('the nav lists every section and marks the current one', async () => {
  renderApp('/settings/appearance');
  const nav = await screen.findByRole('navigation', { name: 'Settings sections' });
  const names = within(nav)
    .getAllByRole('link')
    .map((a) => a.textContent);
  expect(names).toEqual([
    'General',
    'Appearance',
    'Sidebar',
    'Shortcuts',
    'Snippets',
    'Providers',
    'Tool servers',
    'Models',
    'Tools',
    'Data',
    'Security',
    'About',
  ]);
  expect(within(nav).getByRole('link', { name: 'Appearance' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(await screen.findByRole('heading', { level: 1, name: 'Appearance' })).toBeInTheDocument();
});

test('an unknown section opens General', async () => {
  renderApp('/settings/nonsense');
  expect(await screen.findByRole('heading', { level: 1, name: 'General' })).toBeInTheDocument();
});

test('says plainly when this browser cannot keep a spare copy of changes', async () => {
  setFakeSettings({ durable: false });
  renderApp('/settings/general');
  expect(
    await screen.findByText(
      "This browser can't keep a spare copy of your changes. Keep this tab open until they are saved.",
    ),
  ).toBeInTheDocument();
});

test('stays quiet when changes are stored on this browser too', async () => {
  renderApp('/settings/general');
  await screen.findByRole('heading', { level: 1, name: 'General' });
  expect(screen.queryByText(/spare copy/)).not.toBeInTheDocument();
});

test('a refused change is listed with Try again', async () => {
  let reject: (err: ApiError, patch: Record<string, unknown>) => void = () => {};
  onSettingsRejected.mockImplementation(((fn: typeof reject) => {
    reject = fn;
    return () => {};
  }) as never);
  const { user } = renderApp('/settings/general');
  await screen.findByRole('heading', { level: 1, name: 'General' });
  act(() =>
    reject(new ApiError('validation_failed', 'Temperature must be between 0 and 2.', 400), {
      chat: { temperature: 9 },
    }),
  );
  const region = await screen.findByRole('region', { name: 'Changes the server refused' });
  expect(region).toHaveTextContent('Temperature must be between 0 and 2.');
  updateSettings.mockClear();
  await user.click(within(region).getByRole('button', { name: 'Try again' }));
  expect(updateSettings).toHaveBeenCalledWith({ chat: { temperature: 9 } });
  expect(
    screen.queryByRole('region', { name: 'Changes the server refused' }),
  ).not.toBeInTheDocument();
});

test('the current section link is scrolled into view in the nav strip', async () => {
  const scrolled: string[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.textContent ?? '');
  };
  try {
    renderApp('/settings/providers');
    await screen.findByRole('heading', { level: 1, name: 'Providers' });
    await vi.waitFor(() => expect(scrolled).toEqual(['Providers']));
  } finally {
    Element.prototype.scrollIntoView = original;
  }
});

test('a recovered store shows the banner with a link to the history', async () => {
  setFakeSettings({ recovered: true });
  const { user } = renderApp('/settings/general');
  const link = await screen.findByRole('link', { name: 'Open data settings' });
  await user.click(link);
  expect(await screen.findByRole('heading', { level: 1, name: 'Data' })).toBeInTheDocument();
});
