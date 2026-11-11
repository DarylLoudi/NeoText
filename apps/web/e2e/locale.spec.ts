import { expect, test } from '@playwright/test';
import { patchSettings, resetState } from './support/api';

test.beforeEach(async ({ request }) => {
  await resetState(request);
  await patchSettings(request, { locale: 'en' });
});

test.afterEach(async ({ request }) => {
  await patchSettings(request, { locale: 'en' });
});

test('switching to Indonesian on a settings page translates the page itself', async ({ page }) => {
  await page.goto('/settings/general');
  // The page's own strings come in a chunk of their own, loaded with the route.
  await expect(
    page.getByText('Defaults for your chats. Every change is saved as you make it.'),
  ).toBeVisible();
  await page.getByText('Bahasa Indonesia', { exact: true }).click();
  await expect(
    page.getByText('Pengaturan bawaan untuk obrolanmu. Setiap perubahan langsung tersimpan.'),
  ).toBeVisible();
  // A reload starts in Indonesian and still has the page strings.
  await page.reload();
  await expect(
    page.getByText('Pengaturan bawaan untuk obrolanmu. Setiap perubahan langsung tersimpan.'),
  ).toBeVisible();
});
