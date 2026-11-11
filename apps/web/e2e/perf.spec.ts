import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { resetState } from './support/api';
import { addAccount, enqueue, seedAccount } from './support/control';
import { APP_URL } from './support/ports';

// Performance budgets. PERF_SLACK multiplies them on slow machines (CI sets 2).
const SLACK = Number(process.env.PERF_SLACK) || 1;
const OPEN_MS = 100 * SLACK;
const LONG_TASK_MS = 50 * SLACK;

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Sidebar' });
const message = (page: Page) => page.getByRole('textbox', { name: 'Message' });

test.describe('with 5,000 chats', () => {
  // Its own account, so the other specs never see these chats.
  const perf = { username: 'perf', password: 'perf horse battery staple' };
  let threadId = '';
  let signedIn: Awaited<ReturnType<BrowserContext['storageState']>>;

  test.beforeAll(async ({ browser, playwright }) => {
    test.setTimeout(120_000);
    const control = await playwright.request.newContext();
    try {
      await addAccount(control, perf.username, perf.password);
      const seeded = await seedAccount(control, { ...perf, chats: 5000, threadMessages: 200 });
      threadId = seeded.threadId ?? '';
    } finally {
      await control.dispose();
    }
    const context = await browser.newContext({ baseURL: APP_URL });
    try {
      await expect(await context.request.post('/api/auth/login', { data: perf })).toBeOK();
      signedIn = await context.storageState();
    } finally {
      await context.close();
    }
  });

  async function perfPage(browser: import('@playwright/test').Browser): Promise<Page> {
    const context = await browser.newContext({
      baseURL: APP_URL,
      locale: 'en-US',
      storageState: signedIn,
    });
    return context.newPage();
  }

  test('opening a cached 200-message conversation', async ({ browser }) => {
    const page = await perfPage(browser);
    try {
      await page.goto(`/c/${threadId}`);
      const thread = page.getByRole('main');
      await expect(thread.getByText('A closing line for message 199.')).toBeVisible();

      // Away to a new chat and back: the conversation now comes from the cache.
      await page.getByRole('link', { name: 'New chat' }).first().click();
      await expect(page).toHaveURL(/\/$/);
      await page.evaluate(() => performance.clearMarks());
      await page.goBack();
      // Only a cheap poll while the chat opens: a locator would walk the DOM on the same thread.
      await page.waitForFunction(
        () => performance.getEntriesByName('neotext:messages-painted').length > 0,
      );
      const openMs = await page.evaluate(() => {
        const [start] = performance.getEntriesByName('neotext:open-start');
        const [painted] = performance.getEntriesByName('neotext:messages-painted');
        return start && painted ? painted.startTime - start.startTime : Number.NaN;
      });
      console.log(`open a cached 200-message chat: ${openMs.toFixed(1)} ms`);
      expect(openMs).toBeLessThanOrEqual(OPEN_MS);
      await expect(thread.getByText('A closing line for message 199.')).toBeVisible();
    } finally {
      await page.context().close();
    }
  });

  test('sidebar stays virtualized with 5,000 chats', async ({ browser }) => {
    const page = await perfPage(browser);
    try {
      const pages: string[] = [];
      page.on('request', (r) => {
        if (/\/api\/conversations\?.*cursor=/.test(r.url())) pages.push(r.url());
      });
      await page.goto('/');
      const rows = sidebar(page).getByRole('listitem');
      await expect(sidebar(page).getByRole('link', { name: 'Seeded chat 5000' })).toBeVisible();
      expect(await rows.count()).toBeLessThan(100);

      // Scroll the sidebar to its end, page after page.
      for (let i = 1; i <= 4; i++) {
        await scrollSidebarToEnd(page);
        await expect.poll(() => pages.length).toBeGreaterThanOrEqual(i);
      }
      expect(await rows.count()).toBeLessThan(100);
      await expect(sidebar(page).getByRole('link', { name: 'Seeded chat 5000' })).toHaveCount(0);
    } finally {
      await page.context().close();
    }
  });
});

/** Scrolls the sidebar's scroll box to the bottom, wherever the list currently is. */
async function scrollSidebarToEnd(page: Page): Promise<void> {
  await sidebar(page).evaluate((aside) => {
    const boxes = [aside, ...aside.querySelectorAll<HTMLElement>('*')];
    const box = boxes.find(
      (el) =>
        /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight,
    );
    box?.scrollTo({ top: box.scrollHeight });
  });
}

test('streaming causes no long tasks', async ({ page, request }) => {
  test.setTimeout(60_000);
  await resetState(request);
  // About 100 tokens a second for ten seconds, with paragraphs and markup as real answers have.
  const tokens = Array.from({ length: 1000 }, (_, i) => {
    if (i % 40 === 39) return '\n\n';
    if (i % 25 === 0) return `**word${i}** `;
    return `word${i} `;
  });
  await enqueue(request, { chunks: tokens, chunkDelayMs: 10 });

  await page.goto('/');
  await message(page).fill('Write a long answer');
  await message(page).press('Enter');
  const thread = page.getByRole('main');
  // Watch from the first streamed words: sending and opening the new chat are not streaming.
  await expect(thread.getByText('word2', { exact: false })).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { longTasks: number[] };
    w.longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.longTasks.push(entry.duration);
    }).observe({ type: 'longtask' });
  });
  await expect(thread.getByText('word998', { exact: false })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Stop generating' })).toHaveCount(0);

  const longTasks = await page.evaluate(
    () => (window as unknown as { longTasks: number[] }).longTasks,
  );
  console.log(
    `long tasks while streaming: ${longTasks.length}, longest ${Math.max(0, ...longTasks).toFixed(0)} ms`,
  );
  expect(longTasks.filter((ms) => ms > LONG_TASK_MS)).toEqual([]);
});

test('SSE responses are not compressed', async ({ page, request }) => {
  await resetState(request);
  await enqueue(request, { chunks: ['Plain ', 'answer'] });
  await page.goto('/');
  const answer = page.waitForResponse(
    (r) => r.url().endsWith('/api/chat') && r.request().method() === 'POST',
  );
  await message(page).fill('Say something');
  await message(page).press('Enter');
  const res = await answer;
  // The browser offers gzip, deflate, br and zstd; the stream must still come back as is.
  expect(await res.request().headerValue('accept-encoding')).toContain('gzip');
  const headers = await res.allHeaders();
  expect(headers['content-type']).toContain('text/event-stream');
  expect(headers['content-encoding']).toBeUndefined();
  await expect(page.getByRole('main').getByText('Plain answer')).toBeVisible();
});
