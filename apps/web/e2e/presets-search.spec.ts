import { expect, type Page, test } from '@playwright/test';
import { patchSettings, resetState } from './support/api';
import { chatRequestBodies, enqueue } from './support/control';

test.beforeEach(async ({ request }) => {
  await resetState(request);
});

const message = (page: Page) => page.getByRole('textbox', { name: 'Message' });
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Sidebar' });

test('a preset starts a chat with its system prompt', async ({ page, request }) => {
  const prompt = 'You are a pirate. Answer every question like one.';
  await page.goto('/');
  const presets = sidebar(page)
    .getByRole('region')
    .filter({ has: page.getByRole('button', { name: 'Presets', exact: true }) });
  await presets.getByRole('button', { name: 'New preset' }).click();

  const editor = page.getByRole('dialog', { name: 'New preset' });
  await editor.getByLabel('Name').fill('Pirate');
  await editor.getByLabel('System prompt').fill(prompt);
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toHaveCount(0);

  await presets.getByRole('button', { name: 'Pirate', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  // The empty chat shows which preset it starts from.
  const starters = page.getByRole('group', { name: 'Start with a preset' });
  await expect(starters.getByRole('button', { name: 'Pirate' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await enqueue(request, { chunks: ['Arr, ', 'matey!'] });
  await message(page).fill('Hello there');
  await message(page).press('Enter');
  await expect(page.getByRole('main').getByText('Arr, matey!')).toBeVisible();
  await expect(page).toHaveURL(/\/c\/.+/);

  const [body] = await chatRequestBodies(request);
  expect(body?.messages[0]).toMatchObject({
    role: 'system',
    content: expect.stringContaining(prompt),
  });
  expect(body?.messages.at(-1)).toMatchObject({ role: 'user' });
});

test('search finds a message and opens it on the right branch', async ({ page, request }) => {
  await enqueue(
    request,
    { chunks: ['Sea otters hold hands while they sleep.'] },
    { chunks: ['Penguins propose with pebbles.'] },
  );
  await page.goto('/');
  await message(page).fill('Tell me an animal fact');
  await message(page).press('Enter');
  const thread = page.getByRole('main');
  await expect(thread.getByText('Sea otters hold hands while they sleep.')).toBeVisible();
  await thread.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await expect(thread.getByText('Penguins propose with pebbles.')).toBeVisible();
  await expect(thread.getByText('2 / 2')).toBeVisible();
  await expect(thread.getByText('Sea otters hold hands')).toHaveCount(0);
  const chatUrl = page.url();

  // The sidebar's search action opens the dialog; so does its shortcut.
  await page.goto('/');
  await sidebar(page)
    .getByRole('button', { name: /^Search/ })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Search chats' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press('Control+Shift+F');
  await expect(dialog).toBeVisible();

  const input = dialog.getByRole('searchbox', { name: 'Search your chats' });
  await expect(input).toBeFocused();
  await input.fill('otters hold');
  const results = dialog.getByRole('list', { name: 'Search results' });
  const hit = results.getByRole('button').filter({ hasText: 'Sea otters hold hands' });
  await expect(hit).toHaveCount(1);
  await expect(hit.locator('mark').first()).toBeVisible();
  await hit.click();

  // The answer sits on the first branch; opening it moves the chat there.
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL((url) => url.href.startsWith(`${chatUrl}?m=`));
  await expect(thread.getByText('Sea otters hold hands while they sleep.')).toBeVisible();
  await expect(thread.getByText('1 / 2')).toBeVisible();
  await expect(thread.getByText('Penguins propose with pebbles.')).toHaveCount(0);

  // The move was saved, so the chat opens on that branch from now on.
  await page.goto(chatUrl);
  await expect(thread.getByText('Sea otters hold hands while they sleep.')).toBeVisible();
  await expect(thread.getByText('1 / 2')).toBeVisible();
});

test('slash snippet with variables', async ({ page, request }) => {
  await patchSettings(request, {
    snippets: [
      {
        id: 'snp_e2e_greet',
        trigger: 'greet',
        title: 'Greeting',
        body: 'Hello {{name}}, welcome to {{place}}.',
      },
      { id: 'snp_e2e_thanks', trigger: 'thanks', title: 'Thanks', body: 'Thank you!' },
    ],
  });
  await enqueue(request, { chunks: ['Terima kasih!'] });
  await page.goto('/');
  // By its label: the box turns into a combobox while the snippet list is open.
  const box = page.getByLabel('Message', { exact: true });
  await box.click();
  await box.pressSequentially('/gr');

  const menu = page.getByRole('listbox', { name: 'Snippets' });
  await expect(menu.getByRole('option')).toHaveCount(1);
  await expect(menu.getByRole('option', { name: '/greet Greeting' })).toBeVisible();
  await box.press('Enter');
  await expect(menu).toHaveCount(0);

  const dialog = page.getByRole('dialog', { name: 'Greeting' });
  await dialog.getByLabel('name', { exact: true }).fill('Ada');
  await dialog.getByLabel('place', { exact: true }).fill('Jakarta');
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await expect(dialog).toHaveCount(0);
  // Insert filled the box; it did not send the message.
  await expect(box).toHaveValue('Hello Ada, welcome to Jakarta.');
  await expect(box).toBeFocused();
  await expect(page).toHaveURL(/\/$/);

  await box.press('Enter');
  await expect(page.getByRole('main').getByText('Terima kasih!')).toBeVisible();
  const [body] = await chatRequestBodies(request);
  expect(JSON.stringify(body?.messages.at(-1))).toContain('Hello Ada, welcome to Jakarta.');
});
