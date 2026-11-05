import { expect, type Page, test } from '@playwright/test';
import { resetState } from './support/api';
import { chatRequestBodies, enqueue } from './support/control';

test.beforeEach(async ({ request }) => {
  await resetState(request);
});

const message = (page: Page) => page.getByRole('textbox', { name: 'Message' });

test('two models side by side, continue with one', async ({ page, request }) => {
  const alpha = Array.from({ length: 8 }, (_, i) => `alpha${i + 1} `);
  const beta = Array.from({ length: 8 }, (_, i) => `beta${i + 1} `);
  // The two requests leave at once, in either order; each script answers its own model.
  await enqueue(
    request,
    { model: 'mock/alpha', chunks: alpha, chunkDelayMs: 250 },
    { model: 'mock/beta', chunks: beta, chunkDelayMs: 250 },
  );

  await page.goto('/');
  await page
    .getByRole('banner')
    .getByRole('button', { name: /mock\/alpha|mock\/beta|Choose a model/ })
    .click();
  await page.getByRole('option', { name: 'mock/alpha' }).click();
  await expect(message(page)).toHaveAttribute('placeholder', 'Message mock/alpha');

  const toggle = page.getByRole('button', { name: 'Compare', exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Add a model' }).click();
  const picker = page.getByRole('dialog', { name: 'Models to compare' });
  await picker.getByRole('option', { name: 'mock/beta' }).click();
  await expect(picker.getByText('2 of 4 chosen')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);

  await message(page).fill('Which is faster?');
  await message(page).press('Enter');

  const columns = page.getByRole('group', { name: '2 answers side by side' });
  const first = columns.getByRole('region', { name: 'alpha', exact: true });
  const second = columns.getByRole('region', { name: 'beta', exact: true });
  // Both write at the same time: each column has its own stop while it streams.
  await expect(first.getByRole('button', { name: 'Stop this answer' })).toBeVisible();
  await expect(second.getByRole('button', { name: 'Stop this answer' })).toBeVisible();
  await expect(first).toContainText(alpha.join('').trim());
  await expect(second).toContainText(beta.join('').trim());
  await expect(columns.getByRole('region')).toHaveCount(2);
  await expect(columns.getByRole('region').nth(1)).toHaveAccessibleName('beta');

  const models = (await chatRequestBodies(request)).map((b) => b.model).sort();
  expect(models).toEqual(['mock/alpha', 'mock/beta']);

  await second.getByRole('button', { name: 'Continue with this answer' }).click();
  const thread = page.getByRole('main');
  await expect(columns).toHaveCount(0);
  await expect(thread.getByText(beta.join('').trim())).toBeVisible();
  await expect(thread.getByText(alpha.join('').trim())).toHaveCount(0);
  await expect(thread.getByText('2 / 2')).toBeVisible();
  await expect(thread.getByRole('button', { name: 'Show comparison' })).toBeVisible();

  // The choice was saved: the chat now continues from the second answer.
  const id = new URL(page.url()).pathname.split('/').at(-1) ?? '';
  const res = await request.get(`/api/conversations/${id}`);
  const detail = (await res.json()) as {
    conversation: { activeLeafId: string };
    messages: { id: string; parts: { type: string; text?: string }[] }[];
  };
  const leaf = detail.messages.find((m) => m.id === detail.conversation.activeLeafId);
  expect(leaf?.parts.map((p) => p.text ?? '').join('')).toContain('beta8');
});
