import { expect, type Page, test } from '@playwright/test';
import { addOpenRouterProvider, patchSettings, removeProvider, resetState } from './support/api';
import { enqueue, enqueueFixture } from './support/control';

// Wide enough for four source cards a page, as the strip measures its own width.
test.use({ viewport: { width: 1440, height: 900 } });

const MODEL = 'deepseek/deepseek-v4.1-flash';

test.beforeEach(async ({ page, request }) => {
  await resetState(request);
  // Source cards ask for favicons; answered here so no public host is ever contacted.
  await page.route('**/api/favicon**', (route) => route.fulfill({ status: 404 }));
});

const message = (page: Page) => page.getByRole('textbox', { name: 'Message' });
const webToggle = (page: Page) => page.getByRole('button', { name: 'Web', exact: true });

/** Seven more sources than the fixture's two (its third repeats the first). */
const extra = Array.from({ length: 7 }, (_, i) => ({
  url: `https://news${i + 3}.example/btc`,
  title: `Bitcoin report ${i + 3}`,
  content: `Snippet number ${i + 3} about the price.`,
}));

async function askWithWeb(page: Page, text: string): Promise<void> {
  await page.goto('/');
  await expect(message(page)).toHaveAttribute('placeholder', /DeepSeek/);
  await webToggle(page).click();
  await expect(webToggle(page)).toHaveAttribute('aria-pressed', 'true');
  await message(page).fill(text);
  await message(page).press('Enter');
}

test.describe('on OpenRouter', () => {
  let providerId: string;
  test.beforeEach(async ({ request }) => {
    providerId = await addOpenRouterProvider(request);
    await patchSettings(request, {
      chat: { defaultModel: { providerId, modelId: MODEL } },
      webSearch: { defaultOn: false },
    });
  });
  test.afterEach(async ({ request }) => {
    await patchSettings(request, { chat: { defaultModel: null } });
    await removeProvider(request, providerId);
  });

  test('answer shows numbered citations and paginated sources', async ({ page, request }) => {
    await enqueueFixture(request, {
      name: 'openrouter-search',
      citations: extra,
      // Long enough that the 'Searching the web…' line is seen even on a slow run.
      processingDelayMs: 3000,
    });
    const sent = page.waitForRequest((r) => r.url().endsWith('/api/chat'));
    await askWithWeb(page, 'Bitcoin price today?');
    expect(
      ((await sent).postDataJSON() as { options: { webSearch: boolean } }).options.webSearch,
    ).toBe(true);
    const thread = page.getByRole('main');
    await expect(thread.getByText('Searching the web…')).toBeVisible();

    const sources = thread.getByRole('region', { name: 'Sources' });
    await expect(sources).toBeVisible();
    await expect(sources.getByText('1–4 of 9', { exact: true })).toBeVisible();
    await sources.getByRole('button', { name: 'Next sources' }).click();
    await expect(sources.getByText('5–8 of 9', { exact: true })).toBeVisible();
    await expect(sources.getByText('Bitcoin report 5')).toBeVisible();
    await expect(thread.getByText('Searched the web once')).toBeVisible();

    // The link to source 1 in the answer is its numbered chip.
    const chip = thread.getByRole('link', { name: 'Source 1: bitcoinprice.corgano.com' });
    await expect(chip).toHaveAttribute('data-source', '1');
    await chip.hover();
    const card = page.getByRole('dialog', { name: 'Bitcoin Price Today (Nov 2): $78,188' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Bitcoin is trading at $78,188');
  });

  test('all sources drawer filters', async ({ page, request }) => {
    await enqueueFixture(request, { name: 'openrouter-search', citations: extra });
    await askWithWeb(page, 'Bitcoin price today?');
    const thread = page.getByRole('main');
    await expect(thread.getByText('Bitcoin is about $78,188 today')).toBeVisible();

    await thread.getByRole('button', { name: 'All sources' }).click();
    const drawer = page.getByRole('dialog', { name: 'All sources' });
    await expect(drawer.getByRole('listitem')).toHaveCount(9);
    await drawer.getByRole('searchbox', { name: 'Search sources' }).fill('bitget');
    await expect(drawer.getByRole('listitem')).toHaveCount(1);
    await expect(drawer.getByRole('link', { name: 'Bitcoin Price USD | Bitget' })).toBeVisible();
    await drawer.getByRole('searchbox', { name: 'Search sources' }).fill('nothing like it');
    await expect(drawer.getByText('No sources match “nothing like it”.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
  });
});

test('a remote image in an answer loads only after a click', async ({ page, request }) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith('https://example.org/')) asked.push(r.url());
  });
  // A tiny stand-in, so the test never reaches the real host.
  await page.route('https://example.org/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  );
  await enqueue(request, { chunks: ['Here it is: ', '![x](https://example.org/p.png)'] });
  await page.goto('/');
  await message(page).fill('Show me the picture');
  await message(page).press('Enter');
  const thread = page.getByRole('main');
  const load = thread.getByRole('button', { name: 'Load image from example.org' });
  await expect(load).toBeVisible();
  await expect(thread.locator('img[src="https://example.org/p.png"]')).toHaveCount(0);
  expect(asked).toEqual([]);

  const loaded = page.waitForRequest('https://example.org/p.png');
  await load.click();
  await loaded;
  await expect(thread.locator('img[src="https://example.org/p.png"]')).toBeVisible();
  expect(asked).toEqual(['https://example.org/p.png']);
});
