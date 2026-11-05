import { expect, type Page, test } from '@playwright/test';
import { addMcpServer, removeMcpServer, resetState } from './support/api';
import { enqueue } from './support/control';

test.beforeEach(async ({ request }) => {
  await resetState(request);
});

const message = (page: Page) => page.getByRole('textbox', { name: 'Message' });

test('fetch_url runs and shows a tool row', async ({ page, request }) => {
  // The link points at this machine, which the page reader refuses to open.
  const link = 'http://127.0.0.1:3422/private-page';
  await enqueue(
    request,
    {
      chunks: [],
      toolCalls: [
        { id: 'call_fetch', name: 'fetch_url', arguments: JSON.stringify({ url: link }) },
      ],
    },
    { chunks: ['I could not open that page.'] },
  );
  await page.goto('/');
  await message(page).fill(`Summarize ${link}`);
  await message(page).press('Enter');

  const thread = page.getByRole('main');
  await expect(thread.getByText('I could not open that page.')).toBeVisible();
  const row = thread.locator('details', { hasText: 'Read a web page' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Failed');
  await row.locator('summary').click();
  await expect(row.getByText('Error', { exact: true })).toBeVisible();
  await expect(row).toContainText('private-page');
});

test.describe('with a tool server', () => {
  let serverId: string;
  test.beforeEach(async ({ request }) => {
    serverId = await addMcpServer(request, 'files');
  });
  test.afterEach(async ({ request }) => {
    await removeMcpServer(request, serverId);
  });

  test('MCP tool asks before running', async ({ page, request }) => {
    await enqueue(
      request,
      {
        chunks: [],
        toolCalls: [{ id: 'call_echo', name: 'mcp_files_echo', arguments: '{"text":"hi"}' }],
      },
      { chunks: ['The server said hi back.'] },
    );
    await page.goto('/');
    await message(page).fill('Use the echo tool');
    await message(page).press('Enter');

    const thread = page.getByRole('main');
    const prompt = thread.getByRole('group', { name: 'files: echo wants to run' });
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText('"text": "hi"');
    await expect(page).toHaveURL(/\/c\/.+/);

    // The question comes from the generation itself, so a reload still shows it.
    await page.reload();
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: 'Allow', exact: true }).click();

    await expect(thread.getByText('The server said hi back.')).toBeVisible();
    await expect(prompt).toHaveCount(0);
    const row = thread.locator('details', { hasText: 'Used files: echo' });
    await expect(row).toBeVisible();
    await row.locator('summary').click();
    await expect(row).toContainText('echo: hi');
  });
});
