import { expect, type Page, test } from '@playwright/test';
import { readSettings, resetState, settingsSaved } from './support/api';
import { restartServer } from './support/control';

test.beforeEach(async ({ request }) => {
  await resetState(request);
});

const html = (page: Page) => page.locator('html');
const dark = (page: Page) => page.getByRole('radio', { name: 'Dark' });
// Loaded from the server (the reset theme), so picking Dark is a real change.
const loaded = (page: Page) =>
  expect(page.getByRole('region', { name: 'Color' }).getByLabel('Match system')).toBeChecked();
const modEnter = (page: Page) => page.getByRole('radio', { name: 'Ctrl or Cmd with Enter' });

test('settings survive a server restart', async ({ page, request }) => {
  await page.goto('/settings/appearance');
  await loaded(page);
  const saved = settingsSaved(page);
  await dark(page).check();
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  await saved;

  await restartServer(request);
  await page.reload();
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  await expect(dark(page)).toBeChecked();
  expect((await readSettings(request)).appearance.theme).toBe('dark');
});

test('a change made while the server is down is delivered later', async ({
  page,
  context,
  request,
}) => {
  await page.goto('/settings/general');
  await expect(modEnter(page)).not.toBeChecked();

  await context.setOffline(true);
  await modEnter(page).check();
  await expect(modEnter(page)).toBeChecked();
  // Nothing reached the server while the browser was offline.
  expect((await readSettings(request)).chat.sendKey).toBe('enter');

  const delivered = page.waitForResponse(
    (r) => r.url().endsWith('/api/settings') && r.request().method() === 'PATCH' && r.ok(),
    { timeout: 30_000 },
  );
  await context.setOffline(false);
  await delivered;
  expect((await readSettings(request)).chat.sendKey).toBe('mod-enter');

  await page.reload();
  await expect(modEnter(page)).toBeChecked();
});

test('two tabs changing different settings both stick', async ({ context, request }) => {
  const appearance = await context.newPage();
  const general = await context.newPage();
  await appearance.goto('/settings/appearance');
  await general.goto('/settings/general');
  await loaded(appearance);
  await expect(dark(appearance)).not.toBeChecked();
  await expect(modEnter(general)).not.toBeChecked();

  await Promise.all([dark(appearance).check(), modEnter(general).check()]);
  await expect
    .poll(async () => {
      const s = await readSettings(request);
      return [s.appearance.theme, s.chat.sendKey];
    })
    .toEqual(['dark', 'mod-enter']);
  // The other tab hears about the change without a reload.
  await expect(html(general)).toHaveAttribute('data-theme', 'dark');

  await appearance.reload();
  await general.reload();
  await expect(dark(appearance)).toBeChecked();
  await expect(modEnter(general)).toBeChecked();
  await expect(html(appearance)).toHaveAttribute('data-theme', 'dark');
});

test('sidebar layout persists', async ({ page, request }) => {
  // Settings shows its own sections in the sidebar; the chats' sidebar is checked from a chat page.
  const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
  await page.goto('/');
  await expect(sidebar.getByRole('heading', { name: 'Folders' })).toBeVisible();

  await page.goto('/settings/sidebar');
  await page.getByRole('switch', { name: 'Folders' }).uncheck();
  await page.getByRole('radio', { name: 'Right' }).check();
  const box = async () => (await page.locator('#app-sidebar').boundingBox())?.x ?? 0;
  await expect.poll(box).toBeGreaterThan(400);
  await expect
    .poll(async () => {
      const s = (await readSettings(request)).sidebar;
      return [s.position, s.sections.find((x) => x.id === 'folders')?.visible];
    })
    .toEqual(['right', false]);

  await page.reload();
  await expect(page.getByRole('switch', { name: 'Folders' })).not.toBeChecked();
  await expect(page.getByRole('radio', { name: 'Right' })).toBeChecked();
  await page.goto('/');
  await expect(sidebar.getByRole('heading', { name: 'Recent' })).toBeVisible();
  await expect(sidebar.getByRole('heading', { name: 'Folders' })).toHaveCount(0);
  await expect.poll(box).toBeGreaterThan(400);
});
