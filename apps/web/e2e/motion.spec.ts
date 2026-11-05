import { expect, type Page, test } from '@playwright/test';
import { patchSettings, resetState } from './support/api';
import { enqueue } from './support/control';

test.beforeEach(async ({ request }) => {
  await resetState(request);
});

/** Starts an answer that never ends and returns the name of its caret's running animation. */
async function caretAnimation(page: Page): Promise<string> {
  await page.goto('/');
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.fill('Write slowly');
  await box.press('Enter');
  const caret = page.locator('[data-caret]');
  await expect(caret).toBeAttached();
  return caret.evaluate((el) => getComputedStyle(el).animationName);
}

test('"Reduce" stops the caret even when the system allows motion', async ({ page, request }) => {
  await enqueue(request, { chunks: ['Partial '], hang: true });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await patchSettings(request, { appearance: { reduceMotion: 'on' } });
  expect(await caretAnimation(page)).toBe('none');
});

test('"Keep" animates the caret even when the system asks for less motion', async ({
  page,
  request,
}) => {
  await enqueue(request, { chunks: ['Partial '], hang: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await patchSettings(request, { appearance: { reduceMotion: 'off' } });
  expect(await caretAnimation(page)).not.toBe('none');
});

test('"System" follows the system setting', async ({ page, request }) => {
  await enqueue(request, { chunks: ['Partial '], hang: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await caretAnimation(page)).toBe('none');
});
