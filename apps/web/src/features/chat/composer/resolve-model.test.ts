import { defaultSettings, type UserSettings } from '@neotext/shared';
import { expect, test } from 'vitest';
import { summary } from '../../../test/chat-fixtures';
import { catalog, deepseek, deepseekFlash, freeModel } from '../../../test/model-fixtures';
import { resolveModel } from './resolve-model';

const ref = (m: { id: string; providerId: string }) => ({
  providerId: m.providerId,
  modelId: m.id,
});
const key = (m: { id: string; providerId: string }) => `${m.providerId}|${m.id}`;

function settings(patch: {
  defaultModel?: { providerId: string; modelId: string } | null;
  favorites?: string[];
}): UserSettings {
  const s = defaultSettings();
  s.chat.defaultModel = patch.defaultModel ?? null;
  s.models.favorites = patch.favorites ?? [];
  return s;
}

const conversation = summary({ modelRef: ref(deepseekFlash) });

test('order of preference', () => {
  const s = settings({ defaultModel: ref(freeModel), favorites: [key(deepseek)] });
  expect(resolveModel(conversation, s, catalog, ref(deepseek))).toEqual(ref(deepseek));
  expect(resolveModel(conversation, s, catalog, null)).toEqual(ref(deepseekFlash));
  expect(resolveModel(null, s, catalog, null)).toEqual(ref(freeModel));
  expect(resolveModel(null, settings({ favorites: [key(deepseek)] }), catalog, null)).toEqual(
    ref(deepseek),
  );
  expect(resolveModel(null, settings({}), catalog, null)).toEqual(ref(deepseek));
});

test('skips models that no longer exist', () => {
  const gone = { providerId: 'prv_1', modelId: 'gone/model' };
  const s = settings({ defaultModel: gone, favorites: ['prv_1|gone/too', key(freeModel)] });
  const c = summary({ modelRef: gone });
  expect(resolveModel(c, s, catalog, gone)).toEqual(ref(freeModel));
  expect(resolveModel(c, settings({ defaultModel: gone }), catalog, null)).toEqual(ref(deepseek));
});

test('a model from another provider is a different model', () => {
  const other = { providerId: 'prv_2', modelId: deepseek.id };
  expect(resolveModel(null, settings({}), catalog, other)).toEqual(ref(deepseek));
});

test('nothing available gives null', () => {
  expect(resolveModel(null, settings({ defaultModel: ref(deepseek) }), [], null)).toBeNull();
});
