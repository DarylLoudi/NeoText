import 'fake-indexeddb/auto';
import { defaultSettings, type SettingsResponse } from '@neotext/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { getSettingsState, hydrateSettings, teardownSettings } from '../../../state/settings';
import { server } from '../../../test/msw';
import { renderWithClient } from '../../../test/renderWithClient';
import { DataSettings } from './DataSettings';

const live = (over: Partial<SettingsResponse> = {}): SettingsResponse => ({
  version: 7,
  settings: defaultSettings(),
  resetPaths: [],
  recovered: false,
  ...over,
});

const NOON = new Date(2026, 10, 3, 12, 30).getTime();
let restores: number[];

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  restores = [];
  const darkSettings = defaultSettings();
  darkSettings.appearance.theme = 'dark';
  server.use(
    http.get('/api/settings', () => HttpResponse.json(live())),
    http.get('/api/conversations', () => HttpResponse.json({ items: [], nextCursor: null })),
    http.get('/api/settings/history', () =>
      HttpResponse.json({
        items: [
          { version: 6, createdAt: NOON, reason: 'autosave' },
          { version: 5, createdAt: NOON - 3_600_000, reason: 'restore' },
          { version: 4, createdAt: NOON - 7_200_000, reason: 'quarantine' },
        ],
      }),
    ),
    http.post('/api/settings/restore', async ({ request }) => {
      const { version } = (await request.json()) as { version: number };
      restores.push(version);
      return HttpResponse.json(live({ version: 8, settings: darkSettings }));
    }),
  );
  await hydrateSettings('u1');
});
afterEach(() => teardownSettings());

test('lists saved versions with the time and the reason in plain words', async () => {
  renderWithClient(<DataSettings />);
  const rows = await screen.findAllByRole('listitem');
  expect(rows).toHaveLength(3);
  expect(rows[0]).toHaveTextContent(/Saved at/);
  expect(rows[0]).toHaveTextContent('12:30');
  expect(rows[0]).toHaveTextContent('Saved automatically');
  expect(rows[1]).toHaveTextContent('Kept before an earlier restore');
  expect(rows[2]).toHaveTextContent("Kept because it couldn't be read");
});

test('restore asks, then updates the store', async () => {
  const { user } = renderWithClient(<DataSettings />);
  const rows = await screen.findAllByRole('listitem');
  await user.click(within(rows[0] as HTMLElement).getByRole('button', { name: 'Restore' }));

  const dialog = await screen.findByRole('dialog', { name: 'Restore these settings?' });
  expect(restores).toEqual([]);
  expect(getSettingsState().settings.appearance.theme).toBe('dark');
  await user.click(within(dialog).getByRole('button', { name: 'Restore' }));

  await waitFor(() => expect(restores).toEqual([6]));
  await waitFor(() => expect(getSettingsState().settings.appearance.theme).toBe('dark'));
  expect(await screen.findByText('Settings restored')).toBeInTheDocument();
});

test('cancelling the confirmation restores nothing', async () => {
  const { user } = renderWithClient(<DataSettings />);
  const rows = await screen.findAllByRole('listitem');
  await user.click(within(rows[1] as HTMLElement).getByRole('button', { name: 'Restore' }));
  const dialog = await screen.findByRole('dialog', { name: 'Restore these settings?' });
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(restores).toEqual([]);
});

test('a version that cannot be read is reported in words, not left silent', async () => {
  server.use(
    http.post('/api/settings/restore', () =>
      HttpResponse.json(
        { error: { code: 'conflict', message: 'That settings version cannot be read.' } },
        { status: 409 },
      ),
    ),
  );
  const { user } = renderWithClient(<DataSettings />);
  const rows = await screen.findAllByRole('listitem');
  await user.click(within(rows[2] as HTMLElement).getByRole('button', { name: 'Restore' }));
  const dialog = await screen.findByRole('dialog', { name: 'Restore these settings?' });
  await user.click(within(dialog).getByRole('button', { name: 'Restore' }));
  expect(await screen.findByText(/That settings version cannot be read/)).toBeInTheDocument();
});

test('says what recovered means and where the backups live', async () => {
  server.use(http.get('/api/settings', () => HttpResponse.json(live({ recovered: true }))));
  await teardownSettings();
  await hydrateSettings('u1');
  renderWithClient(<DataSettings />);
  expect(await screen.findByText(/Your saved settings couldn't be read/)).toBeInTheDocument();
  expect(screen.getByText(/backups folder/)).toBeInTheDocument();
});

test('has no history yet', async () => {
  server.use(http.get('/api/settings/history', () => HttpResponse.json({ items: [] })));
  renderWithClient(<DataSettings />);
  expect(await screen.findByText(/No earlier versions yet/)).toBeInTheDocument();
});
