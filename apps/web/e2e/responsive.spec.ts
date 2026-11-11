import { expect, type Page, test } from '@playwright/test';
import { resetState } from './support/api';
import { enqueue } from './support/control';

test.beforeEach(async ({ request }) => {
  await resetState(request);
});

const sidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('no page scrolls sideways on a phone', async ({ page, request }) => {
  await enqueue(request, {
    chunks: [
      '| Model | Context | Input price | Output price |\n|---|---|---|---|\n' +
        '| alpha-super-long-model-name-v4 | 1,000,000 | $0.10 | $0.40 |\n',
    ],
  });
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  const message = page.getByRole('textbox', { name: 'Message' });
  await message.fill('A table please');
  await page.getByRole('button', { name: 'Send message' }).click();
  const thread = page.getByRole('main');
  // A narrow table scrolls on its own and keeps numbers whole.
  await expect(thread.getByRole('cell', { name: '1,000,000' })).toBeVisible();
  const lines = await thread.getByRole('cell', { name: '1,000,000' }).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
  });
  expect(lines).toBe(1);
  expect(await sidewaysScroll(page)).toBe(0);

  for (const path of ['/admin/users', '/admin/audit', '/settings/models', '/usage']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await sidewaysScroll(page), path).toBe(0);
  }
});
