import { expect, type Page, test } from '@playwright/test';
import { createChat, resetState } from './support/api';

test.beforeEach(async ({ request }) => {
  await resetState(request);
});

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Sidebar' });
const section = (page: Page, name: string) =>
  sidebar(page)
    .getByRole('region')
    .filter({ has: page.getByRole('button', { name, exact: true }) });
const link = (page: Page, title: string) =>
  sidebar(page).getByRole('link', { name: title, exact: true });

async function chooseFromRowMenu(page: Page, title: string, item: string) {
  const row = sidebar(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: title, exact: true }) });
  await row.hover();
  await row.getByRole('button', { name: `Options for ${title}` }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

test('rename, pin and archive a chat from its menu', async ({ page, request }) => {
  await createChat(request, 'Sidebar one');
  await page.goto('/');
  await expect(link(page, 'Sidebar one')).toBeVisible();

  await chooseFromRowMenu(page, 'Sidebar one', 'Rename');
  const field = sidebar(page).getByRole('textbox', { name: 'Chat title' });
  await field.fill('Sidebar renamed');
  await field.press('Enter');
  await expect(link(page, 'Sidebar renamed')).toBeVisible();

  await chooseFromRowMenu(page, 'Sidebar renamed', 'Pin');
  await expect(
    section(page, 'Pinned').getByRole('link', { name: 'Sidebar renamed' }),
  ).toBeVisible();
  await expect(section(page, 'Recent').getByRole('link', { name: 'Sidebar renamed' })).toHaveCount(
    0,
  );

  await chooseFromRowMenu(page, 'Sidebar renamed', 'Archive');
  await expect(link(page, 'Sidebar renamed')).toHaveCount(0);

  // The same state comes back after a reload: it was saved, not just drawn.
  await page.reload();
  await expect(sidebar(page).getByRole('heading', { name: 'Recent' })).toBeVisible();
  await expect(link(page, 'Sidebar renamed')).toHaveCount(0);
});

test('delete a chat and undo it', async ({ page, request }) => {
  await createChat(request, 'Sidebar two');
  await page.goto('/');
  await expect(link(page, 'Sidebar two')).toBeVisible();

  await chooseFromRowMenu(page, 'Sidebar two', 'Delete');
  await expect(link(page, 'Sidebar two')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(link(page, 'Sidebar two')).toBeVisible();

  await page.reload();
  await expect(link(page, 'Sidebar two')).toBeVisible();
});

test('create a folder and move a chat into it', async ({ page, request }) => {
  await createChat(request, 'Sidebar three');
  await page.goto('/');
  await expect(link(page, 'Sidebar three')).toBeVisible();

  await sidebar(page).getByRole('button', { name: 'New folder' }).click();
  const name = sidebar(page).getByRole('textbox', { name: 'Folder name' });
  await name.fill('Thesis');
  await name.press('Enter');
  await expect(section(page, 'Folders').getByText('Thesis')).toBeVisible();

  await chooseFromRowMenu(page, 'Sidebar three', 'Move to folder');
  await page.getByRole('menuitem', { name: 'Thesis', exact: true }).click();
  await expect(section(page, 'Recent').getByRole('link', { name: 'Sidebar three' })).toHaveCount(0);
  await section(page, 'Folders').getByRole('button', { name: 'Thesis', exact: true }).click();
  await expect(section(page, 'Folders').getByRole('link', { name: 'Sidebar three' })).toBeVisible();

  await page.reload();
  await section(page, 'Folders').getByRole('button', { name: 'Thesis', exact: true }).click();
  await expect(section(page, 'Folders').getByRole('link', { name: 'Sidebar three' })).toBeVisible();
});
