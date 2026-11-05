import { expect, test } from 'vitest';
import { type JsonObject, migrateSettings } from './migrations';

test('current version is untouched', () => {
  expect(migrateSettings({ a: 1 }, 1)).toEqual({ data: { a: 1 }, version: 1, migrated: false });
});
test('newer stored version is never migrated down', () => {
  expect(migrateSettings({ a: 1 }, 7)).toEqual({ data: { a: 1 }, version: 7, migrated: false });
});
test('applies migrations in order up to the target', () => {
  const steps = {
    1: (r: JsonObject) => ({ ...r, step1: true }),
    2: (r: JsonObject) => ({ ...r, step2: true }),
  };
  expect(migrateSettings({}, 1, steps, 3)).toEqual({
    data: { step1: true, step2: true },
    version: 3,
    migrated: true,
  });
});
test('a version without a registered step passes data through', () => {
  expect(migrateSettings({ a: 1 }, 1, {}, 2)).toEqual({
    data: { a: 1 },
    version: 2,
    migrated: true,
  });
});
