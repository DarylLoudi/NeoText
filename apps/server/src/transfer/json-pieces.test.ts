import { describe, expect, test } from 'vitest';
import { jsonObjectWriter } from './json-pieces';

const value = {
  version: 1,
  app: 'NeoText "x" ✓',
  settings: { appearance: { theme: 'dark', list: [1, [2, { a: null }]] }, empty: {} },
  skipped: undefined,
  folders: [],
  messages: [
    { id: 'm1', parts: [{ type: 'text', text: 'Halo\nbaris dua' }] },
    { id: 'm2', parts: [] },
    'plain',
    3,
  ],
  last: [{ nested: { deep: [true, false] } }],
};

function written(indent: 0 | 2): string {
  const w = jsonObjectWriter(indent);
  w.value('version', value.version);
  w.value('app', value.app);
  w.value('settings', value.settings);
  w.value('skipped', value.skipped);
  w.beginArray('folders');
  w.items([]);
  w.endArray();
  w.beginArray('messages');
  w.items(value.messages.slice(0, 1));
  w.items([]);
  w.items(value.messages.slice(1));
  w.endArray();
  w.beginArray('last');
  w.items(value.last);
  w.endArray();
  const out = w.end();
  expect(w.bytes).toBe(out.length);
  return out.toString('utf8');
}

describe('json pieces', () => {
  test('writes the same text as one JSON.stringify, compact and indented', () => {
    expect(written(0)).toBe(JSON.stringify(value));
    expect(written(2)).toBe(JSON.stringify(value, null, 2));
  });

  test('an object with no fields is {}', () => {
    expect(jsonObjectWriter(2).end().toString()).toBe('{}');
    expect(jsonObjectWriter(0).end().toString()).toBe('{}');
  });
});
