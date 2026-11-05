import { expect, test } from '@playwright/test';
import { account, enqueue, mockUrl, resetMock } from './support/control';

test('setup, recovery gate, connect a custom endpoint, first answer', async ({ page, request }) => {
  await resetMock(request);
  const url = await mockUrl(request);

  await page.goto('/');
  await expect(page).toHaveURL(/\/setup/);

  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Username').fill(account.username);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByLabel('Repeat password').fill(account.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  // The recovery key is shown once, and Continue waits for the person to say they saved it.
  await expect(page.getByRole('heading', { name: 'Save your recovery key' })).toBeVisible();
  await expect(page.locator('code')).toContainText('-');
  const next = page.getByRole('button', { name: 'Continue' });
  await expect(next).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I saved my recovery key' }).check();
  await expect(next).toBeEnabled();
  await next.click();

  // No key on the server, so the wizard offers a provider; skip it and add one in settings.
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('button', { name: 'Open provider settings' }).click();
  await expect(page).toHaveURL(/\/settings\/providers/);
  await page.getByRole('button', { name: 'Add provider' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Service' }).click();
  await page.getByRole('option', { name: 'Custom endpoint' }).click();
  await dialog.getByLabel('Name').fill('Mock');
  await dialog.getByLabel('Base URL').fill(url);
  await dialog.getByRole('button', { name: 'Add provider' }).click();
  await expect(page.getByText('Provider added')).toBeVisible();

  await page.getByRole('button', { name: 'Edit Mock' }).click();
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText(/Connected in \d+ ?ms/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('link', { name: 'New chat' }).click();
  await page
    .getByRole('banner')
    .getByRole('button', { name: /mock\/alpha|Choose a model/ })
    .click();
  await page.getByRole('option', { name: 'mock/beta' }).click();
  const box = page.getByRole('textbox', { name: 'Message' });
  await expect(box).toHaveAttribute('placeholder', 'Message mock/beta');

  await enqueue(request, { chunks: ['Halo ', 'juga!'] });
  await box.fill('Halo');
  await box.press('Enter');
  const thread = page.getByRole('main');
  await expect(thread.getByText('Halo juga!')).toBeVisible();
  await expect(page).toHaveURL(/\/c\/.+/);
  // The title call is the mock's default answer; wait for it so nothing is left in flight.
  await expect(page.getByRole('navigation', { name: 'Chats' }).getByText('ok')).toBeVisible();

  await page.reload();
  await expect(thread.getByText('Halo juga!')).toBeVisible();
  await expect(thread.getByText('Halo', { exact: true })).toBeVisible();
});
