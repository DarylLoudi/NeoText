import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { resetFakeSettings, setFakeSettings, updateSettings } from '../../../test/fake-settings';
import { renderWithClient } from '../../../test/renderWithClient';
import { SnippetsSettings } from './SnippetsSettings';

vi.mock('../../../state/settings', () => import('../../../test/fake-settings'));

beforeEach(() => {
  resetFakeSettings();
});

const saved = [{ id: 's1', trigger: 'sum', title: 'Summarise', body: 'Summarise this.' }];

async function fill(user: ReturnType<typeof renderWithClient>['user'], trigger: string) {
  await user.type(screen.getByRole('textbox', { name: 'Trigger' }), trigger);
  await user.type(screen.getByRole('textbox', { name: 'Title' }), 'A title');
  await user.type(screen.getByRole('textbox', { name: 'Text' }), 'Some text');
}

test('shows an empty state and adds a snippet', async () => {
  const { user } = renderWithClient(<SnippetsSettings />);
  expect(screen.getByText('No snippets yet.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Add snippet' }));
  await fill(user, 'hi');
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  const call = updateSettings.mock.lastCall?.[0] as { snippets: Record<string, string>[] };
  expect(call.snippets).toHaveLength(1);
  expect(call.snippets[0]).toMatchObject({ trigger: 'hi', title: 'A title', body: 'Some text' });
  expect(call.snippets[0]?.id).toBeTruthy();
});

test('duplicate triggers are refused', async () => {
  setFakeSettings({ settings: { snippets: saved } });
  const { user } = renderWithClient(<SnippetsSettings />);
  await user.click(screen.getByRole('button', { name: 'Add snippet' }));
  await fill(user, 'sum');
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(updateSettings).not.toHaveBeenCalled();
  expect(screen.getByText(/already used/)).toBeInTheDocument();
});

test('a trigger with capitals or spaces is refused', async () => {
  const { user } = renderWithClient(<SnippetsSettings />);
  await user.click(screen.getByRole('button', { name: 'Add snippet' }));
  await fill(user, 'No Good');
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(updateSettings).not.toHaveBeenCalled();
  expect(screen.getByText(/lowercase letters/)).toBeInTheDocument();
});

test('edits and deletes', async () => {
  setFakeSettings({ settings: { snippets: saved } });
  const { user } = renderWithClient(<SnippetsSettings />);
  const row = within(screen.getByRole('listitem'));
  await user.click(row.getByRole('button', { name: 'Edit' }));
  const title = screen.getByRole('textbox', { name: 'Title' });
  await user.clear(title);
  await user.type(title, 'Short');
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(updateSettings).toHaveBeenLastCalledWith({
    snippets: [{ ...saved[0], title: 'Short' }],
  });
  await user.click(within(screen.getByRole('listitem')).getByRole('button', { name: 'Delete' }));
  expect(updateSettings).toHaveBeenLastCalledWith({ snippets: [] });
});

test('a title over 200 characters is refused, and the list stays as it was', async () => {
  setFakeSettings({ settings: { snippets: saved } });
  const { user } = renderWithClient(<SnippetsSettings />);
  await user.click(within(screen.getByRole('listitem')).getByRole('button', { name: 'Edit' }));
  const title = screen.getByRole('textbox', { name: 'Title' });
  expect(title).toHaveAttribute('maxlength', '200');
  // A pasted or scripted value can still pass the box's own limit.
  fireEvent.change(title, { target: { value: 'x'.repeat(201) } });
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(updateSettings).not.toHaveBeenCalled();
  expect(
    screen.getByText('The title can be up to 200 characters. Shorten it and try again.'),
  ).toBeInTheDocument();
  // The dialog stays open over the list, which still holds the saved snippet.
  expect(screen.getByRole('listitem', { hidden: true })).toHaveTextContent('Summarise');
});
