import { expect, type Page, test } from '@playwright/test';
import { createChat, readSettings, resetState, settingsSaved } from './support/api';

test.beforeEach(async ({ request }) => {
  await resetState(request);
});

/** Opens the palette with its shortcut, once the app has finished drawing itself. */
async function openPalette(page: Page) {
  await expect(page.getByRole('button', { name: /^Search/ })).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
}

test('the palette finds a chat, runs an action and opens settings', async ({ page, request }) => {
  const id = await createChat(request, 'Palette quarry');
  await page.goto('/');
  await openPalette(page);
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const input = palette.getByRole('combobox', { name: 'Search chats, models and actions' });
  await expect(input).toBeFocused();

  await input.fill('quarry');
  await palette.getByRole('option', { name: 'Palette quarry' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${id}$`));
  await expect(palette).toHaveCount(0);

  await openPalette(page);
  await input.fill('dark');
  const saved = settingsSaved(page);
  await palette.getByRole('option', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await saved;
  expect((await readSettings(request)).appearance.theme).toBe('dark');

  await openPalette(page);
  await input.fill('providers');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/settings\/providers/);
});
