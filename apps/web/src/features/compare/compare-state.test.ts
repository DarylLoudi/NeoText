import { beforeEach, expect, test, vi } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

test('a picked answer is still picked after the page reloads', async () => {
  const first = await import('./compare-state');
  first.chooseAnswer('msg_1');
  expect(first.isChosen('msg_1')).toBe(true);

  vi.resetModules(); // a reload: the module starts again, the browser storage stays
  const second = await import('./compare-state');
  expect(second.isChosen('msg_1')).toBe(true);
  expect(second.isChosen('msg_2')).toBe(false);
});

test('reopening the comparison is remembered too', async () => {
  const first = await import('./compare-state');
  first.chooseAnswer('msg_1');
  first.showComparison('msg_1');

  vi.resetModules();
  const second = await import('./compare-state');
  expect(second.isChosen('msg_1')).toBe(false);
});

test('unreadable storage starts with nothing picked', async () => {
  localStorage.setItem('neotext:compare-chosen', '{not json');
  const mod = await import('./compare-state');
  expect(mod.isChosen('msg_1')).toBe(false);
  mod.chooseAnswer('msg_1');
  expect(mod.isChosen('msg_1')).toBe(true);
});
