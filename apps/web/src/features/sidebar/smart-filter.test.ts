import { expect, test } from 'vitest';
import { smartFilterToQuery } from './smart-filter';

const now = Date.UTC(2026, 10, 3);

test('smart filter maps to a list query', () => {
  expect(
    smartFilterToQuery({ modelIds: ['deepseek/deepseek-v4.1-flash'], updatedWithinDays: 7 }, now),
  ).toEqual({
    scope: 'all',
    modelId: 'deepseek/deepseek-v4.1-flash',
    updatedSince: now - 7 * 86_400_000,
  });
  expect(smartFilterToQuery({ folderIds: ['fld_1'], titleContains: 'skripsi' }, now)).toEqual({
    scope: 'folder',
    folderId: 'fld_1',
    titleContains: 'skripsi',
  });
});

test('an empty filter lists every chat', () => {
  expect(smartFilterToQuery({}, now)).toEqual({ scope: 'all' });
});

test('blank text and empty lists add nothing', () => {
  expect(smartFilterToQuery({ modelIds: [], folderIds: [], titleContains: '  ' }, now)).toEqual({
    scope: 'all',
  });
});

test('the query carries only keys that have a value', () => {
  const query = smartFilterToQuery({ titleContains: 'a' }, now);
  expect(Object.keys(query).sort()).toEqual(['scope', 'titleContains']);
});
