import { DEFAULT_SIDEBAR_SECTIONS, type SidebarSection } from '@neotext/shared';
import { expect, test } from 'vitest';
import { addSmartSection, moveSection, removeSection, setSectionVisible } from './section-ops';

const defaults = (): SidebarSection[] => structuredClone([...DEFAULT_SIDEBAR_SECTIONS]);
const ids = (sections: SidebarSection[]) => sections.map((s) => s.id);

test('moveSection reorders', () => {
  expect(ids(moveSection(defaults(), 'recent', 'pinned')).slice(0, 2)).toEqual([
    'recent',
    'pinned',
  ]);
  expect(ids(moveSection(defaults(), 'pinned', 'recent')).slice(0, 3)).toEqual([
    'folders',
    'recent',
    'pinned',
  ]);
});

test('moveSection leaves the list alone for unknown or identical ids', () => {
  const before = defaults();
  expect(moveSection(before, 'recent', 'recent')).toBe(before);
  expect(moveSection(before, 'recent', 'nope')).toBe(before);
  expect(moveSection(before, 'nope', 'recent')).toBe(before);
});

test('moveSection keeps every section, unknown kinds included, untouched', () => {
  const future = { id: 'later', kind: 'from-the-future', visible: true, collapsed: false, x: 1 };
  const moved = moveSection([future, ...defaults()], 'recent', 'pinned');
  expect(moved).toHaveLength(6);
  expect(moved.find((s) => s.id === 'later')).toBe(future);
});

test('setSectionVisible changes one section only', () => {
  const next = setSectionVisible(defaults(), 'pinned', false);
  expect(next.find((s) => s.id === 'pinned')?.visible).toBe(false);
  expect(next.filter((s) => !s.visible).map((s) => s.id)).toEqual(['pinned', 'archived']);
  expect(next.find((s) => s.id === 'recent')).toEqual(defaults().find((s) => s.id === 'recent'));
});

test('addSmartSection inserts before archived', () => {
  const filter = { titleContains: 'skripsi' };
  const next = addSmartSection(defaults(), { title: 'Skripsi', filter }, 'smart-1');
  expect(ids(next)).toEqual(['pinned', 'folders', 'recent', 'presets', 'smart-1', 'archived']);
  expect(next[4]).toEqual({
    id: 'smart-1',
    kind: 'smart',
    visible: true,
    collapsed: false,
    title: 'Skripsi',
    filter,
  });
});

test('addSmartSection appends when there is no archived section', () => {
  const without = defaults().filter((s) => s.id !== 'archived');
  expect(ids(addSmartSection(without, { title: 'A', filter: {} }, 's')).at(-1)).toBe('s');
});

test('only smart sections can be removed', () => {
  const withSmart = addSmartSection(defaults(), { title: 'A', filter: {} }, 'smart-1');
  expect(ids(removeSection(withSmart, 'smart-1'))).toEqual(ids(defaults()));
  const before = defaults();
  expect(removeSection(before, 'recent')).toBe(before);
  expect(removeSection(before, 'nope')).toBe(before);
});
