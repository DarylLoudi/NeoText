import { expect, type Page, test } from '@playwright/test';
import { resetState } from './support/api';
import { enqueue } from './support/control';

test.beforeEach(async ({ request }) => {
  await resetState(request);
});

const message = (page: Page) => page.getByRole('textbox', { name: 'Message' });
const call = (id: string, name: string, args: object) => ({
  id,
  name,
  arguments: JSON.stringify(args),
});

const INDEX = `<!doctype html>
<html>
<head><link rel="stylesheet" href="style.css"></head>
<body>
<h1>Todo</h1>
<p id="saved">none</p>
<button id="save">Save</button>
<a href="about.html">About</a>
<script src="app.js"></script>
</body>
</html>`;
const APP = `const saved = document.getElementById('saved');
saved.textContent = localStorage.getItem('note') || 'none';
document.getElementById('save').addEventListener('click', () => {
  localStorage.setItem('note', 'kept');
  saved.textContent = 'kept';
  console.log('saved the note');
});`;

async function send(page: Page, text: string) {
  await message(page).fill(text);
  await message(page).press('Enter');
}

test('the model builds a page, the preview runs it, and an edit becomes v2', async ({
  page,
  request,
}) => {
  await enqueue(
    request,
    {
      chunks: [],
      toolCalls: [
        call('c1', 'write_file', { path: 'index.html', content: INDEX }),
        call('c2', 'write_file', { path: 'style.css', content: 'h1 { color: rgb(255, 0, 0); }' }),
        call('c3', 'write_file', { path: 'app.js', content: APP }),
        call('c4', 'write_file', {
          path: 'about.html',
          content: '<!doctype html><h1>About page</h1>',
        }),
      ],
    },
    { chunks: ['Your page is ready.'] },
  );
  await page.goto('/');
  await send(page, 'Make me a todo page');
  const thread = page.getByRole('main');
  await expect(thread.getByText('Your page is ready.')).toBeVisible();
  const row = thread.getByText(
    'v1 · created index.html, created style.css, created app.js, created about.html',
  );
  await expect(row).toBeVisible();
  await thread.getByRole('button', { name: 'Open preview' }).click();

  const panel = page.getByRole('complementary', { name: 'Preview' });
  await expect(panel).toBeVisible();
  const frame = page.frameLocator('iframe[title="Preview of index.html"]');
  await expect(frame.locator('h1')).toHaveCSS('color', 'rgb(255, 0, 0)');
  await frame.getByRole('button', { name: 'Save' }).click();
  await expect(frame.locator('#saved')).toHaveText('kept');
  await panel.getByText('Console').click();
  await expect(panel.getByText('saved the note')).toBeVisible();

  // A link to another page of the project opens inside the preview.
  await frame.getByRole('link', { name: 'About' }).click();
  await expect(
    page.frameLocator('iframe[title="Preview of about.html"]').getByText('About page'),
  ).toBeVisible();

  await enqueue(
    request,
    {
      chunks: [],
      toolCalls: [
        call('c5', 'edit_file', {
          path: 'style.css',
          old_text: 'rgb(255, 0, 0)',
          new_text: 'rgb(0, 0, 255)',
        }),
      ],
    },
    { chunks: ['The title is blue now.'] },
  );
  await send(page, 'Make the title blue');
  await expect(thread.getByText('The title is blue now.')).toBeVisible();
  await expect(thread.getByText('v2 · edited style.css')).toBeVisible();
  await expect(panel.getByRole('combobox', { name: 'Version' })).toHaveText('v2 of 2');
  await panel.getByRole('combobox', { name: 'Page' }).click();
  await page.getByRole('option', { name: 'index.html' }).click();
  const updated = page.frameLocator('iframe[title="Preview of index.html"]');
  await expect(updated.locator('h1')).toHaveCSS('color', 'rgb(0, 0, 255)');
  // What the page saved is still there after the new version loaded.
  await expect(updated.locator('#saved')).toHaveText('kept');
});

test('the preview follows an edit made mid-answer, and the branch on screen', async ({
  page,
  request,
}) => {
  await enqueue(
    request,
    {
      chunks: [],
      toolCalls: [
        call('c1', 'write_file', {
          path: 'index.html',
          content: '<!doctype html><h1 id="t">One</h1>',
        }),
      ],
    },
    { chunks: ['Ready.'] },
  );
  await page.goto('/');
  await send(page, 'Make a page');
  const thread = page.getByRole('main');
  await expect(thread.getByText('Ready.')).toBeVisible();
  await thread.getByRole('button', { name: 'Open preview' }).click();
  const title = page.frameLocator('iframe[title="Preview of index.html"]').locator('#t');
  await expect(title).toHaveText('One');

  await enqueue(
    request,
    {
      chunks: [],
      toolCalls: [
        call('c2', 'edit_file', { path: 'index.html', old_text: 'One', new_text: 'Two' }),
      ],
    },
    {
      chunks: ['Changing', ' the', ' title', ' now', '.', ' Done', ' with', ' Two', '.'],
      chunkDelayMs: 600,
    },
  );
  await send(page, 'Call it Two');
  // The edit shows while the answer is still being written.
  await expect(title).toHaveText('Two');
  await expect(thread.getByText('Changing the title now. Done with Two.')).toHaveCount(0);
  await expect(thread.getByText('Changing the title now. Done with Two.')).toBeVisible();

  await enqueue(
    request,
    {
      chunks: [],
      toolCalls: [
        call('c3', 'edit_file', { path: 'index.html', old_text: 'One', new_text: 'Three' }),
      ],
    },
    { chunks: ['Three it is.'] },
  );
  const lastAnswer = thread.getByRole('article', { name: 'alpha' }).last();
  await lastAnswer.hover();
  await lastAnswer.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await expect(thread.getByText('Three it is.')).toBeVisible();
  await expect(title).toHaveText('Three');
  await thread.getByRole('button', { name: 'Previous version' }).click();
  await expect(thread.getByText('1 / 2')).toBeVisible();
  await expect(title).toHaveText('Two');
});

test('a page that moves itself stays in the preview; Escape twice inside it reaches the panel', async ({
  page,
  request,
}) => {
  await enqueue(
    request,
    {
      chunks: [],
      toolCalls: [
        call('c1', 'write_file', {
          path: 'index.html',
          content: `<!doctype html><button id="go" onclick="location.href = 'about.html'">Go</button>`,
        }),
        call('c2', 'write_file', {
          path: 'about.html',
          content: '<!doctype html><h1>About page</h1><input aria-label="Name">',
        }),
      ],
    },
    { chunks: ['Ready.'] },
  );
  await page.goto('/');
  await send(page, 'Make two pages');
  const thread = page.getByRole('main');
  await expect(thread.getByText('Ready.')).toBeVisible();
  await thread.getByRole('button', { name: 'Open preview' }).click();
  const panel = page.getByRole('complementary', { name: 'Preview' });
  await page
    .frameLocator('iframe[title="Preview of index.html"]')
    .getByRole('button', { name: 'Go' })
    .click();
  const about = page.frameLocator('iframe[title="Preview of about.html"]');
  await expect(about.getByText('About page')).toBeVisible();

  const name = about.getByRole('textbox', { name: 'Name' });
  await name.click();
  // One Escape stays with the page; two in a row leave it.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  await expect(name).toBeFocused();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(panel.getByRole('button', { name: 'Close preview' })).toBeFocused();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
});

test('a full HTML page in a code block opens in the preview', async ({ page, request }) => {
  await enqueue(request, {
    chunks: ['Here it is:\n\n```html\n<!doctype html>\n<p id="hello">From a code block</p>\n```\n'],
  });
  await page.goto('/');
  await send(page, 'Write a page');
  const thread = page.getByRole('main');
  await thread.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(
    page.frameLocator('iframe[title="Preview of index.html"]').locator('#hello'),
  ).toHaveText('From a code block');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the preview covers the screen and nothing scrolls sideways', async ({ page, request }) => {
    await enqueue(request, {
      chunks: ['```html\n<!doctype html>\n<p>Small screen</p>\n```\n'],
    });
    await page.goto('/');
    await send(page, 'Write a page');
    await page.getByRole('main').getByRole('button', { name: 'Preview', exact: true }).click();
    const panel = page.getByRole('complementary', { name: 'Preview' });
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(389);
    expect(box?.height).toBeGreaterThanOrEqual(843);
    const sideways = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(sideways).toBe(false);
    await panel.getByRole('button', { name: 'Close preview' }).click();
    await expect(panel).toHaveCount(0);
  });
});
