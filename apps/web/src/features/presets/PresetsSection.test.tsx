import type { Preset } from '@neotext/shared';
import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { resetFakeSettings, setFakeSettings } from '../../test/fake-settings';
import { server } from '../../test/msw';
import { mockBackend, renderApp } from '../../test/renderApp';
import { stubLayout } from '../../test/sidebar-backend';
import { getPendingPreset, setPendingPreset } from './use-presets';

vi.mock('../../state/settings', () => import('../../test/fake-settings'));

let restoreLayout: () => void;
beforeEach(() => {
  resetFakeSettings();
  setPendingPreset(null);
  mockBackend({ signedIn: true });
  restoreLayout = stubLayout();
});
afterEach(() => restoreLayout());

const preset = (over: Partial<Preset> = {}): Preset => ({
  id: 'pst_1',
  name: 'Tutor',
  position: 'a0',
  createdAt: 0,
  updatedAt: 0,
  data: {
    systemPrompt: 'Teach.',
    model: null,
    reasoningEffort: null,
    temperature: null,
    maxOutputTokens: null,
    webSearch: true,
    color: null,
  },
  ...over,
});

test('click starts a new chat with the preset', async () => {
  server.use(http.get('/api/presets', () => HttpResponse.json({ presets: [preset()] })));
  const { user, router } = renderApp('/settings');
  await user.click(await screen.findByRole('button', { name: 'Tutor' }, { timeout: 5000 }));
  expect(getPendingPreset()?.id).toBe('pst_1');
  await waitFor(() => expect(router.state.location.pathname).toBe('/'));
});

test('an empty list offers a new preset', async () => {
  server.use(http.get('/api/presets', () => HttpResponse.json({ presets: [] })));
  const { user } = renderApp('/');
  await user.click(await screen.findByRole('button', { name: 'New preset' }));
  expect(await screen.findByRole('dialog', { name: 'New preset' })).toBeInTheDocument();
});

test('the new-chat shortcut and palette drop a pending preset', async () => {
  server.use(http.get('/api/presets', () => HttpResponse.json({ presets: [preset()] })));
  const { user } = renderApp('/');
  await user.click(await screen.findByRole('button', { name: 'Tutor' }, { timeout: 5000 }));
  expect(getPendingPreset()?.id).toBe('pst_1');
  await user.keyboard('{Control>}{Shift>}o{/Shift}{/Control}');
  await waitFor(() => expect(getPendingPreset()).toBeNull());
});

test('the presets quick action lists presets and starts a chat with one', async () => {
  server.use(http.get('/api/presets', () => HttpResponse.json({ presets: [preset()] })));
  setFakeSettings({ settings: { sidebar: { quickActions: ['new-chat', 'presets'] } } });
  const { user, router } = renderApp('/settings');
  await screen.findByRole('button', { name: 'Tutor' }, { timeout: 5000 });
  const trigger = screen
    .getAllByRole('button', { name: 'Presets' })
    .find((b) => b.getAttribute('aria-haspopup') === 'menu');
  await user.click(trigger as HTMLElement);
  await user.click(await screen.findByRole('menuitem', { name: 'Tutor' }));
  expect(getPendingPreset()?.id).toBe('pst_1');
  await waitFor(() => expect(router.state.location.pathname).toBe('/'));
});
