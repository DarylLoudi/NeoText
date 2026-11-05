import { screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { resetFakeSettings, setFakeSettings, updateSettings } from '../../../test/fake-settings';
import { renderWithClient } from '../../../test/renderWithClient';
import { ShortcutsSettings } from './ShortcutsSettings';

vi.mock('../../../state/settings', () => import('../../../test/fake-settings'));

beforeEach(() => {
  resetFakeSettings();
});

const row = (name: string) => {
  const el = screen.getByRole('listitem', { name });
  return within(el);
};

test('lists every action with its current combo', () => {
  renderWithClient(<ShortcutsSettings />);
  expect(row('Open the command palette').getByText('Ctrl')).toBeInTheDocument();
  expect(row('Open the command palette').getByText('K')).toBeInTheDocument();
  expect(row('Start a new chat').getByText('Shift')).toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(7);
});

test('Change captures the next chord and saves it', async () => {
  const { user } = renderWithClient(<ShortcutsSettings />);
  await user.click(row('Open the command palette').getByRole('button', { name: 'Change' }));
  expect(screen.getByText('Press the new keys, or Escape to cancel.')).toBeInTheDocument();
  await user.keyboard('{Control>}p{/Control}');
  expect(updateSettings).toHaveBeenLastCalledWith({ shortcuts: { palette: '$mod+KeyP' } });
  expect(screen.queryByText('Press the new keys, or Escape to cancel.')).not.toBeInTheDocument();
});

test('Escape while capturing leaves the shortcut alone', async () => {
  const { user } = renderWithClient(<ShortcutsSettings />);
  await user.click(row('Open the command palette').getByRole('button', { name: 'Change' }));
  await user.keyboard('{Escape}');
  expect(updateSettings).not.toHaveBeenCalled();
  expect(screen.queryByText('Press the new keys, or Escape to cancel.')).not.toBeInTheDocument();
});

test('a chord another action uses is refused and says which', async () => {
  const { user } = renderWithClient(<ShortcutsSettings />);
  await user.click(row('Open the command palette').getByRole('button', { name: 'Change' }));
  await user.keyboard('{Control>}b{/Control}');
  expect(updateSettings).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Ctrl+B is already used by “Show or hide the sidebar”. Press other keys, or change that one first.',
  );
});

test('a plain letter cannot be a shortcut', async () => {
  const { user } = renderWithClient(<ShortcutsSettings />);
  await user.click(row('Open the command palette').getByRole('button', { name: 'Change' }));
  await user.keyboard('p');
  expect(updateSettings).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('Include Ctrl, Alt or Cmd');
});

test('Reset appears only for changed shortcuts and removes the override', async () => {
  setFakeSettings({ settings: { shortcuts: { palette: '$mod+KeyP' } } });
  const { user } = renderWithClient(<ShortcutsSettings />);
  expect(row('Start a new chat').queryByRole('button', { name: 'Reset' })).toBeNull();
  expect(row('Open the command palette').getByText('P')).toBeInTheDocument();
  await user.click(row('Open the command palette').getByRole('button', { name: 'Reset' }));
  expect(updateSettings).toHaveBeenLastCalledWith({ shortcuts: { palette: null } });
});

test('Reset all clears every override at once', async () => {
  setFakeSettings({
    settings: { shortcuts: { palette: '$mod+KeyP', 'new-chat': '$mod+KeyN' } },
  });
  const { user } = renderWithClient(<ShortcutsSettings />);
  await user.click(screen.getByRole('button', { name: 'Reset all' }));
  expect(updateSettings).toHaveBeenLastCalledWith({
    shortcuts: { palette: null, 'new-chat': null },
  });
});

test.each([
  ['c', 'Ctrl+C'],
  ['v', 'Ctrl+V'],
  ['x', 'Ctrl+X'],
  ['a', 'Ctrl+A'],
  ['z', 'Ctrl+Z'],
  ['y', 'Ctrl+Y'],
])('%s with Ctrl is refused: it is for editing text', async (letter) => {
  const { user } = renderWithClient(<ShortcutsSettings />);
  await user.click(row('Open the command palette').getByRole('button', { name: 'Change' }));
  await user.keyboard(`{Control>}${letter}{/Control}`);
  expect(updateSettings).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'That key is used for editing text. Pick another.',
  );
  // Still listening, so another chord can be tried straight away.
  await user.keyboard('{Control>}p{/Control}');
  expect(updateSettings).toHaveBeenLastCalledWith({ shortcuts: { palette: '$mod+KeyP' } });
});

test('a function key on its own is refused', async () => {
  const { user } = renderWithClient(<ShortcutsSettings />);
  await user.click(row('Open the command palette').getByRole('button', { name: 'Change' }));
  await user.keyboard('{F5}');
  expect(updateSettings).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('Include Ctrl, Alt or Cmd');
});
