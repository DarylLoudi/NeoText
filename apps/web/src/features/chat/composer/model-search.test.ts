import { expect, test } from 'vitest';
import {
  catalog,
  deepseek,
  deepseekFlash,
  freeModel,
  modelInfo,
} from '../../../test/model-fixtures';
import { searchModels } from './model-search';

test('matches all words across name and id', () => {
  expect(searchModels(catalog, 'deepseek flash').map((m) => m.id)).toEqual([
    'deepseek/deepseek-v4.1-flash',
  ]);
});

test('is case-insensitive and ignores extra spaces', () => {
  expect(searchModels(catalog, '  DEEPSEEK   v4.1 ').map((m) => m.id)).toEqual([
    deepseek.id,
    deepseekFlash.id,
  ]);
});

test('words can match the name in one place and the id in another', () => {
  const m = modelInfo({ id: 'vendor/x-1', name: 'Writer' });
  expect(searchModels([m], 'writer vendor')).toEqual([m]);
  expect(searchModels([m], 'writer nobody')).toEqual([]);
});

test('an empty query lists everything with favorites first, in their own order', () => {
  const favorites = new Set([`prv_1|${freeModel.id}`]);
  expect(searchModels(catalog, '', favorites).map((m) => m.id)).toEqual([
    freeModel.id,
    deepseek.id,
    deepseekFlash.id,
  ]);
  expect(searchModels(catalog, '   ').map((m) => m.id)).toEqual(catalog.map((m) => m.id));
});

test('with a query the catalog order is kept, favorites do not jump the queue', () => {
  const favorites = new Set([`prv_1|${deepseekFlash.id}`]);
  expect(searchModels(catalog, 'deepseek', favorites).map((m) => m.id)).toEqual([
    deepseek.id,
    deepseekFlash.id,
  ]);
});

test('450 models filter in a blink', () => {
  const many = Array.from({ length: 450 }, (_, i) =>
    modelInfo({ id: `lab/model-${i}`, name: `Model ${i}` }),
  );
  searchModels(many, 'warm up');
  const start = performance.now();
  for (let i = 0; i < 50; i++) searchModels(many, 'model 44');
  expect(performance.now() - start).toBeLessThan(200);
  expect(searchModels(many, 'model 449').map((m) => m.id)).toEqual(['lab/model-449']);
});
