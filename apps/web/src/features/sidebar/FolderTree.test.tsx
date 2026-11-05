import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { resetFakeSettings } from '../../test/fake-settings';
import { mockBackend, renderApp } from '../../test/renderApp';
import { folder, serveSidebar, stubLayout } from '../../test/sidebar-backend';

vi.mock('../../state/settings', () => import('../../test/fake-settings'));

let restoreLayout: () => void;
beforeEach(() => {
  resetFakeSettings();
  mockBackend({ signedIn: true });
  restoreLayout = stubLayout();
});
afterEach(() => restoreLayout());

const folders = () => [
  folder({ id: 'fld_1', name: 'Thesis', position: 'a0' }),
  folder({ id: 'fld_2', name: 'Reading', position: 'a1' }),
  folder({ id: 'fld_3', name: 'Lab', position: 'a2' }),
];

const names = ['Thesis', 'Reading', 'Lab'];
const order = () =>
  within(screen.getByRole('list', { name: 'Folders' }))
    .getAllByRole('button')
    .map((b) => b.textContent)
    .filter((name) => names.includes(name ?? ''));

async function openMenu(user: ReturnType<typeof renderApp>['user'], name: string) {
  await user.click(await screen.findByRole('button', { name: `Options for ${name}` }));
  return screen.findByRole('menu');
}

test('a folder moves up and down from its menu', async () => {
  const { calls } = serveSidebar({ folders: folders() });
  const { user } = renderApp('/');
  await screen.findByRole('button', { name: 'Lab' });

  let menu = await openMenu(user, 'Lab');
  await user.click(within(menu).getByRole('menuitem', { name: 'Move up' }));
  await waitFor(() => expect(order()).toEqual(['Thesis', 'Lab', 'Reading']));
  const patch = calls.find((c) => c.method === 'PATCH' && c.path === '/api/folders/fld_3');
  const moved = (patch?.body as { position?: string } | undefined)?.position ?? '';
  expect(moved > 'a0' && moved < 'a1').toBe(true);

  menu = await openMenu(user, 'Thesis');
  await user.click(within(menu).getByRole('menuitem', { name: 'Move down' }));
  await waitFor(() => expect(order()).toEqual(['Lab', 'Thesis', 'Reading']));
});

test('the first folder cannot move up, the last cannot move down', async () => {
  serveSidebar({ folders: folders() });
  const { user } = renderApp('/');
  let menu = await openMenu(user, 'Thesis');
  expect(within(menu).getByRole('menuitem', { name: 'Move up' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  expect(within(menu).getByRole('menuitem', { name: 'Move down' })).not.toHaveAttribute(
    'aria-disabled',
  );
  await user.keyboard('{Escape}');
  menu = await openMenu(user, 'Lab');
  expect(within(menu).getByRole('menuitem', { name: 'Move down' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
});
