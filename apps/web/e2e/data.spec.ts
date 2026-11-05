import path from 'node:path';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { resetState } from './support/api';
import { addAccount, chatRequestBodies, enqueue } from './support/control';
import { APP_URL } from './support/ports';

test.beforeEach(async ({ request }) => {
  await resetState(request);
});

const message = (page: Page) => page.getByRole('textbox', { name: 'Message' });
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Sidebar' });
const link = (page: Page, title: string) =>
  sidebar(page).getByRole('link', { name: title, exact: true });
const group = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

/** Asks one question in a new chat, waits for the answer, and names the chat. */
async function chatWith(
  page: Page,
  request: APIRequestContext,
  chat: { title: string; question: string; answer: string },
): Promise<void> {
  await enqueue(request, { chunks: [chat.answer] });
  await page.goto('/');
  await message(page).fill(chat.question);
  await message(page).press('Enter');
  await expect(page.getByRole('main').getByText(chat.answer)).toBeVisible();
  await expect(page).toHaveURL(/\/c\/.+/);
  const id = new URL(page.url()).pathname.split('/').at(-1);
  const res = await request.patch(`/api/conversations/${id}`, { data: { title: chat.title } });
  if (!res.ok()) throw new Error(`Renaming the chat failed: ${res.status()}`);
}

async function chooseFromRowMenu(page: Page, title: string, item: string) {
  const row = sidebar(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: title, exact: true }) });
  await row.hover();
  await row.getByRole('button', { name: `Options for ${title}` }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

test('export then import restores everything elsewhere', async ({
  browser,
  page,
  request,
}, testInfo) => {
  const chats = [
    {
      title: 'Export garden',
      question: 'When do tulips bloom?',
      answer: 'Tulips bloom in spring.',
    },
    { title: 'Export kitchen', question: 'How long is pasta?', answer: 'Boil it for ten minutes.' },
  ];
  for (const chat of chats) await chatWith(page, request, chat);
  const presets = sidebar(page).getByRole('list', { name: 'Presets' });
  await sidebar(page).getByRole('button', { name: 'New preset' }).click();
  const editor = page.getByRole('dialog', { name: 'New preset' });
  await editor.getByLabel('Name').fill('Exported preset');
  await editor.getByLabel('System prompt').fill('Answer in haiku.');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(presets.getByRole('button', { name: 'Exported preset', exact: true })).toBeVisible();

  const passphrase = 'river stone lantern 42';
  await page.goto('/settings/data');
  const exporting = group(page, 'Export');
  await expect(exporting.getByRole('radio', { name: 'NeoText file (encrypted)' })).toBeChecked();
  await exporting.getByLabel('Passphrase', { exact: true }).fill(passphrase);
  await exporting.getByLabel('Repeat passphrase').fill(passphrase);
  const downloading = page.waitForEvent('download');
  await exporting.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.ntxb$/);
  const file = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  await expect(page.getByText('Export downloaded')).toBeVisible();

  // Someone else on the same server, starting with nothing.
  const grace = { username: 'grace', password: 'another horse battery' };
  await addAccount(request, grace.username, grace.password);
  const context = await browser.newContext({
    baseURL: APP_URL,
    locale: 'en-US',
    storageState: { cookies: [], origins: [] },
  });
  try {
    const signIn = await context.request.post('/api/auth/login', { data: grace });
    await expect(signIn).toBeOK();
    const other = await context.newPage();
    await other.goto('/');
    await expect(
      sidebar(other).getByText('No chats yet. Start a new chat to begin.'),
    ).toBeVisible();

    await other.goto('/settings/data');
    const importing = group(other, 'Import');
    await expect(importing.getByRole('radio', { name: 'NeoText file' })).toBeChecked();
    await importing.getByLabel('File', { exact: true }).setInputFiles(file);
    await importing.getByLabel('Passphrase', { exact: true }).fill(passphrase);
    await importing.getByRole('button', { name: 'Import', exact: true }).click();
    const summary = importing.getByRole('status');
    await expect(summary).toContainText(/\d+ chats imported/);
    await expect(summary).not.toContainText('could not be imported');

    await other.goto('/');
    for (const chat of chats) await expect(link(other, chat.title)).toBeVisible();
    await expect(
      sidebar(other).getByRole('list', { name: 'Presets' }).getByRole('button', {
        name: 'Exported preset',
        exact: true,
      }),
    ).toBeVisible();
    await link(other, 'Export garden').click();
    const thread = other.getByRole('main');
    await expect(thread.getByText('Tulips bloom in spring.')).toBeVisible();
    await expect(thread.getByText('When do tulips bloom?')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('ChatGPT export import', async ({ page }) => {
  const fixture = path.resolve(
    import.meta.dirname,
    '../../server/test-support/fixtures/chatgpt-export.json',
  );
  await page.goto('/settings/data');
  const importing = group(page, 'Import');
  await importing.getByRole('radio', { name: 'ChatGPT' }).check();
  await importing.getByLabel('File', { exact: true }).setInputFiles(fixture);
  await importing.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(importing.getByRole('status')).toContainText('1 chat imported');

  await page.goto('/');
  await link(page, 'Rencana liburan').click();
  const thread = page.getByRole('main');
  // The export's current branch is the one shown, with the other answer one step back.
  await expect(thread.getByText('Selesai')).toBeVisible();
  await expect(thread.getByText('Jawaban B')).toBeVisible();
  await expect(thread.getByText('2 / 2')).toBeVisible();
  await thread.getByRole('button', { name: 'Previous version' }).click();
  await expect(thread.getByText('1 / 2')).toBeVisible();
  await expect(thread.getByText('Jawaban A')).toBeVisible();
  await expect(thread.getByText('Selesai')).toHaveCount(0);
});

test('trash undo and restore', async ({ page, request }) => {
  const res = await request.post('/api/conversations', { data: { title: 'Trash round trip' } });
  await expect(res).toBeOK();
  await page.goto('/');
  await expect(link(page, 'Trash round trip')).toBeVisible();

  await chooseFromRowMenu(page, 'Trash round trip', 'Delete');
  await expect(link(page, 'Trash round trip')).toHaveCount(0);
  await expect(page.getByText('Chat moved to trash')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(link(page, 'Trash round trip')).toBeVisible();

  await chooseFromRowMenu(page, 'Trash round trip', 'Delete');
  await expect(link(page, 'Trash round trip')).toHaveCount(0);
  await page.goto('/settings/data');
  const trash = group(page, 'Trash');
  const row = trash.getByRole('listitem').filter({ hasText: 'Trash round trip' });
  await expect(row).toContainText('30 days left');
  await row.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('Chat restored')).toBeVisible();
  await expect(row).toHaveCount(0);

  await page.goto('/');
  await expect(link(page, 'Trash round trip')).toBeVisible();
});

test('image attachment reaches the model', async ({ page, request }) => {
  // A 1x1 PNG.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  await enqueue(request, { chunks: ['A single pixel.'] });
  await page.goto('/');
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Attach a file' }).click();
  await (await choosing).setFiles({ name: 'dot.png', mimeType: 'image/png', buffer: png });

  const chips = page.getByRole('list', { name: 'Attached files' });
  await expect(chips.getByRole('listitem').filter({ hasText: 'dot.png' })).toBeVisible();
  await expect(chips.getByRole('progressbar')).toHaveCount(0);
  await expect(chips).not.toContainText("can't read");

  await message(page).fill('What is in this picture?');
  await message(page).press('Enter');
  const thread = page.getByRole('main');
  await expect(thread.getByText('A single pixel.')).toBeVisible();
  // The message keeps the picture, served back from the server.
  const thumb = thread.getByRole('link', { name: 'Open dot.png' }).getByRole('img');
  await expect(thumb).toBeVisible();
  await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);

  const [body] = await chatRequestBodies(request);
  const content = body?.messages.at(-1)?.content;
  expect(Array.isArray(content)).toBe(true);
  const parts = content as { type: string; image_url?: { url: string }; text?: string }[];
  expect(parts).toContainEqual(expect.objectContaining({ type: 'text' }));
  const image = parts.find((p) => p.type === 'image_url');
  expect(image?.image_url?.url).toBe(`data:image/png;base64,${png.toString('base64')}`);
});
