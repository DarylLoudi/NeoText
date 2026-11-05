import { expect, test } from 'vitest';
import { sectionArea } from './SectionSidebar';

test('settings and admin pages own the sidebar, every other page keeps the chats', () => {
  expect(sectionArea('/settings/data')).toBe('settings');
  expect(sectionArea('/admin/users')).toBe('admin');
  expect(sectionArea('/')).toBeNull();
  expect(sectionArea('/c/abc')).toBeNull();
  expect(sectionArea('/usage')).toBeNull();
});
