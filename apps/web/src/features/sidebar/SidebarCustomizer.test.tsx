import { defaultSettings, type JsonObject } from '@neotext/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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

type Section = { id: string; kind: string; visible: boolean; title?: string; filter?: object };
const lastSections = (): Section[] => {
  const patch = updateSettings.mock.calls.at(-1)?.[0] as { sidebar: { sections: Section[] } };
  return patch.sidebar.sections;
};
const lastSidebarPatch = (): Record<string, unknown> => {
  const patch = updateSettings.mock.calls.at(-1)?.[0] as { sidebar: Record<string, unknown> };
  return patch.sidebar;
};
const defaultSections = () => defaultSettings().sidebar.sections as unknown as JsonObject[];

async function openCustomizer() {
  const app = renderApp('/');
  await app.user.click(await screen.findByRole('button', { name: /Account menu/ }));
  await app.user.click(await screen.findByRole('menuitem', { name: 'Customize sidebar' }));
  const dialog = await screen.findByRole('dialog', { name: 'Customize sidebar' });
  return { ...app, dialog };
}

test('toggling a section saves the whole array through settings', async () => {
  serveSidebar();
  const { user, dialog } = await openCustomizer();
  await user.click(within(dialog).getByRole('switch', { name: 'Pinned' }));
  expect(updateSettings).toHaveBeenCalledTimes(1);
  const sections = lastSections();
  expect(sections.map((s) => s.id)).toEqual(['pinned', 'folders', 'recent', 'presets', 'archived']);
  expect(sections.find((s) => s.id === 'pinned')?.visible).toBe(false);
  expect(sections.find((s) => s.id === 'recent')?.visible).toBe(true);
});

test('sections of unknown kinds stay in place and untouched', async () => {
  const future = { id: 'later', kind: 'from-the-future', visible: true, collapsed: false, x: 1 };
  setFakeSettings({ settings: { sidebar: { sections: [future, ...defaultSections()] } } });
  serveSidebar();
  const { user, dialog } = await openCustomizer();
  expect(within(dialog).queryByText('from-the-future')).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole('switch', { name: 'Recent' }));
  expect(lastSections()[0]).toEqual(future);
  expect(lastSections()).toHaveLength(6);
});

test('Move up and Move down reorder from the keyboard', async () => {
  serveSidebar();
  const { user, dialog } = await openCustomizer();
  expect(within(dialog).getByRole('button', { name: 'Move Pinned up' })).toBeDisabled();
  await user.click(within(dialog).getByRole('button', { name: 'Move Pinned down' }));
  expect(
    lastSections()
      .map((s) => s.id)
      .slice(0, 2),
  ).toEqual(['folders', 'pinned']);
  await user.click(within(dialog).getByRole('button', { name: 'Move Recent up' }));
  expect(
    lastSections()
      .map((s) => s.id)
      .slice(0, 3),
  ).toEqual(['folders', 'recent', 'pinned']);
});

test('the last section cannot move down', async () => {
  serveSidebar();
  const { dialog } = await openCustomizer();
  expect(within(dialog).getByRole('button', { name: 'Move Archived down' })).toBeDisabled();
});

test('a smart section can be added, shows in the sidebar, and is queried from its filter', async () => {
  const { calls } = serveSidebar({
    conversations: [conv(Date.now(), { title: 'Skripsi bab 1' }), conv(Date.now(), { title: 'x' })],
  });
  const { user, dialog } = await openCustomizer();
  await user.click(within(dialog).getByRole('button', { name: 'Add smart section' }));
  const editor = await screen.findByRole('dialog', { name: 'Add smart section' });
  const add = within(editor).getByRole('button', { name: 'Add section' });
  expect(add).toBeDisabled();
  await user.type(within(editor).getByRole('textbox', { name: 'Section name' }), 'Skripsi');
  await user.type(within(editor).getByRole('textbox', { name: 'Title contains' }), 'skripsi');
  await user.click(add);

  const sections = lastSections();
  expect(sections.map((s) => s.id).slice(-1)).toEqual(['archived']);
  const made = sections.at(-2);
  expect(made).toMatchObject({
    kind: 'smart',
    visible: true,
    title: 'Skripsi',
    filter: { titleContains: 'skripsi' },
  });
  expect(made?.id).toMatch(/^smart-/);

  // Back on the list, the new section is listed with a Remove button.
  const list = await screen.findByRole('dialog', { name: 'Customize sidebar' });
  expect(within(list).getByRole('button', { name: 'Remove Skripsi' })).toBeInTheDocument();
  expect(within(list).queryByRole('button', { name: 'Remove Pinned' })).not.toBeInTheDocument();

  await user.click(within(list).getByRole('button', { name: 'Done' }));
  expect(await screen.findByRole('button', { name: 'Skripsi' })).toBeInTheDocument();
  await waitFor(() =>
    expect(
      calls.some(
        (c) => c.search.includes('scope=all') && c.search.includes('titleContains=skripsi'),
      ),
    ).toBe(true),
  );
});

test('the editor previews how many chats match', async () => {
  serveSidebar({
    conversations: [
      conv(Date.now(), { title: 'Skripsi bab 1' }),
      conv(Date.now(), { title: 'Skripsi bab 2' }),
    ],
  });
  const { user, dialog } = await openCustomizer();
  await user.click(within(dialog).getByRole('button', { name: 'Add smart section' }));
  const editor = await screen.findByRole('dialog', { name: 'Add smart section' });
  expect(await within(editor).findByText('2 chats match')).toBeInTheDocument();
});

test('the editor filters by a model picked from the server list', async () => {
  server.use(
    http.get('/api/models', () =>
      HttpResponse.json({
        providers: [
          {
            providerId: 'p1',
            providerName: 'Provider',
            models: [
              {
                id: 'deepseek/deepseek-v4.1-flash',
                providerId: 'p1',
                name: 'DeepSeek Flash',
                description: null,
                contextLength: null,
                maxOutputTokens: null,
                inputModalities: ['text'],
                outputModalities: ['text'],
                pricing: { promptPerM: null, completionPerM: null, cacheReadPerM: null },
                supports: {
                  tools: null,
                  reasoning: null,
                  structuredOutputs: null,
                  webSearch: false,
                },
                reasoning: null,
                knowledgeCutoff: null,
                expiresAt: null,
                createdAt: null,
              },
            ],
            stale: false,
            error: null,
          },
        ],
      }),
    ),
  );
  const { calls } = serveSidebar({ folders: [folder({ id: 'fld_1', name: 'Thesis' })] });
  const { user, dialog } = await openCustomizer();
  await user.click(within(dialog).getByRole('button', { name: 'Add smart section' }));
  const editor = await screen.findByRole('dialog', { name: 'Add smart section' });
  expect(within(editor).getByRole('combobox', { name: 'Folder' })).toBeInTheDocument();
  expect(within(editor).getByRole('combobox', { name: 'Updated within' })).toBeInTheDocument();

  await user.click(within(editor).getByRole('combobox', { name: 'Model' }));
  await user.click(await screen.findByRole('option', { name: 'DeepSeek Flash' }));
  await waitFor(() =>
    expect(calls.some((c) => c.search.includes('modelId=deepseek%2Fdeepseek-v4.1-flash'))).toBe(
      true,
    ),
  );
  await user.type(within(editor).getByRole('textbox', { name: 'Section name' }), 'Flash');
  await user.click(within(editor).getByRole('button', { name: 'Add section' }));
  expect(lastSections().at(-2)?.filter).toEqual({ modelIds: ['deepseek/deepseek-v4.1-flash'] });
});

test('removing a smart section saves without it', async () => {
  const base = defaultSections();
  const smart = {
    id: 'smart-1',
    kind: 'smart',
    visible: true,
    collapsed: false,
    title: 'Skripsi',
    filter: { titleContains: 'skripsi' },
  };
  const archived = base[4] as JsonObject;
  setFakeSettings({ settings: { sidebar: { sections: [...base.slice(0, 4), smart, archived] } } });
  serveSidebar();
  const { user, dialog } = await openCustomizer();
  await user.click(within(dialog).getByRole('button', { name: 'Remove Skripsi' }));
  expect(lastSections().map((s) => s.id)).toEqual([
    'pinned',
    'folders',
    'recent',
    'presets',
    'archived',
  ]);
});

test('position, density, width and quick actions save', async () => {
  serveSidebar();
  const { user, dialog } = await openCustomizer();

  await user.click(within(dialog).getByRole('radio', { name: 'Right' }));
  expect(lastSidebarPatch()).toEqual({ position: 'right' });

  await user.click(within(dialog).getByRole('radio', { name: 'Compact' }));
  expect(updateSettings).toHaveBeenLastCalledWith({ appearance: { density: 'compact' } });

  const width = within(dialog).getByRole('slider', { name: 'Width' });
  fireEvent.change(width, { target: { value: '340' } });
  expect(lastSidebarPatch()).toEqual({ width: 340 });

  await user.click(within(dialog).getByRole('checkbox', { name: 'Search' }));
  expect(lastSidebarPatch()).toEqual({ quickActions: ['new-chat'] });
  await user.click(within(dialog).getByRole('checkbox', { name: 'Search' }));
  expect(lastSidebarPatch()).toEqual({ quickActions: ['new-chat', 'search'] });
});

test('dragging the width slider shows the width live and saves once, on release', async () => {
  serveSidebar();
  const { dialog } = await openCustomizer();
  const width = within(dialog).getByRole('slider', { name: 'Width' });
  for (const value of ['300', '320', '336']) fireEvent.input(width, { target: { value } });
  expect(within(dialog).getByText('336 px')).toBeInTheDocument();
  expect(updateSettings).not.toHaveBeenCalled();
  fireEvent.pointerUp(width);
  expect(updateSettings).toHaveBeenCalledTimes(1);
  expect(lastSidebarPatch()).toEqual({ width: 336 });
  // The release also fires `change`; the same width is not saved twice.
  fireEvent.change(width, { target: { value: '336' } });
  expect(updateSettings).toHaveBeenCalledTimes(1);
});

test('arrow keys move the width slider and save on key release', async () => {
  serveSidebar();
  const { dialog } = await openCustomizer();
  const width = within(dialog).getByRole('slider', { name: 'Width' });
  fireEvent.input(width, { target: { value: '292' } });
  expect(updateSettings).not.toHaveBeenCalled();
  fireEvent.keyUp(width, { key: 'ArrowRight' });
  expect(lastSidebarPatch()).toEqual({ width: 292 });
});

test('reset asks first, then restores the defaults', async () => {
  setFakeSettings({
    settings: {
      sidebar: {
        position: 'right',
        width: 400,
        sections: [...defaultSections()].reverse(),
        quickActions: [],
      },
    },
  });
  serveSidebar();
  const { user, dialog } = await openCustomizer();
  await user.click(within(dialog).getByRole('button', { name: 'Reset sidebar' }));
  const confirm = await screen.findByRole('dialog', { name: 'Reset sidebar?' });
  expect(updateSettings).not.toHaveBeenCalled();

  await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Reset sidebar?' })).not.toBeInTheDocument(),
  );
  expect(updateSettings).not.toHaveBeenCalled();

  await user.click(within(dialog).getByRole('button', { name: 'Reset sidebar' }));
  await user.click(
    within(await screen.findByRole('dialog', { name: 'Reset sidebar?' })).getByRole('button', {
      name: 'Reset sidebar',
    }),
  );
  const defaults = defaultSettings().sidebar;
  expect(updateSettings).toHaveBeenCalledTimes(1);
  expect(lastSidebarPatch()).toEqual({
    position: defaults.position,
    width: defaults.width,
    quickActions: defaults.quickActions,
    sections: defaults.sections,
  });
});
