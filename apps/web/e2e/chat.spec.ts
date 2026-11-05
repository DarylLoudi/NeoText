import { expect, type Page, test } from '@playwright/test';
import { resetState } from './support/api';
import { chatRequestCount, enqueue } from './support/control';

test.beforeEach(async ({ request }) => {
  await resetState(request);
});

const message = (page: Page) => page.getByRole('textbox', { name: 'Message' });

test('reload during an answer still finishes it', async ({ page, request }) => {
  const words = Array.from({ length: 20 }, (_, i) => `w${i + 1} `);
  await enqueue(request, { chunks: words, chunkDelayMs: 150 });

  await page.goto('/');
  await message(page).fill('Count to twenty');
  await message(page).press('Enter');
  const thread = page.getByRole('main');
  await expect(thread.getByText('w3', { exact: false })).toBeVisible();
  await expect(page).toHaveURL(/\/c\/.+/);

  await page.reload();
  await expect(thread).toContainText(words.join('').trim());
  await expect(page.getByRole('button', { name: 'Stop generating' })).toHaveCount(0);
  await expect(page.getByText('Reconnecting')).toHaveCount(0);
  // The question was asked once; the reload did not send it again.
  expect(await chatRequestCount(request)).toBe(1);
});

test('regenerate creates a branch switcher', async ({ page, request }) => {
  await enqueue(request, { chunks: ['First answer'] }, { chunks: ['Second answer'] });
  await page.goto('/');
  await message(page).fill('Tell me something');
  await message(page).press('Enter');
  const thread = page.getByRole('main');
  await expect(thread.getByText('First answer')).toBeVisible();

  await thread.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await expect(thread.getByText('Second answer')).toBeVisible();
  await expect(thread.getByText('2 / 2')).toBeVisible();
  await expect(thread.getByText('First answer')).toHaveCount(0);

  await thread.getByRole('button', { name: 'Previous version' }).click();
  await expect(thread.getByText('1 / 2')).toBeVisible();
  await expect(thread.getByText('First answer')).toBeVisible();
});

test('stop keeps partial text', async ({ page, request }) => {
  await enqueue(request, { chunks: ['Partial ', 'text'], hang: true });
  await page.goto('/');
  await message(page).fill('Write slowly');
  await message(page).press('Enter');
  const thread = page.getByRole('main');
  await expect(thread.getByText('Partial text')).toBeVisible();

  await page.getByRole('button', { name: 'Stop generating' }).click();
  await expect(thread.getByText('Stopped.')).toBeVisible();
  await expect(thread.getByText('Partial text')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();

  await page.reload();
  await expect(thread.getByText('Partial text')).toBeVisible();
  await expect(thread.getByText('Stopped.')).toBeVisible();
});

test('Enter during IME composition picks a candidate and does not send', async ({
  page,
  request,
}) => {
  await enqueue(request, { chunks: ['Diterima'] });
  await page.goto('/');
  const box = message(page);
  await box.focus();

  // A real composition through the browser's input-method protocol, then the Enter that
  // confirms a candidate: the browser reports it as part of the composition.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'にほん', selectionStart: 3, selectionEnd: 3 });
  await expect(box).toHaveValue('にほん');
  await box.evaluate((el) =>
    el.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 229,
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await cdp.send('Input.insertText', { text: '日本' });
  await expect(box).toHaveValue('日本');
  await expect(page).toHaveURL(/\/$/);
  expect(await chatRequestCount(request)).toBe(0);

  // After the composition has ended, the same key sends.
  const sent = page.waitForRequest((r) => r.url().endsWith('/api/chat'));
  await box.press('Enter');
  const body = (await sent).postDataJSON() as { userMessage: { text: string } };
  expect(body.userMessage.text).toBe('日本');
  await expect(page.getByRole('main').getByText('Diterima')).toBeVisible();
});

test('each paragraph of a mixed-direction message takes its own direction', async ({
  page,
  request,
}) => {
  await enqueue(request, { chunks: ['Diterima'] });
  await page.goto('/');
  await message(page).fill('مرحبا بالعالم\nHello world');
  await message(page).press('Enter');
  const text = page.getByRole('main').locator('p', { hasText: 'Hello world' });
  await expect(text).toBeVisible();
  expect(await text.evaluate((el) => getComputedStyle(el).unicodeBidi)).toBe('plaintext');
});
