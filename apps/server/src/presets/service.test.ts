import type { Preset, PresetData } from '@neotext/shared';
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  addUser,
  authContextFor,
  authed,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';
import { aad } from '../crypto/aad';
import { openJson, openText } from '../crypto/aead';

let t: TestApp;
let api: ReturnType<typeof authed>;
let cookie: string;

const data = (over: Partial<PresetData> = {}): PresetData => ({
  systemPrompt: 'Be brief.',
  model: null,
  reasoningEffort: null,
  temperature: null,
  maxOutputTokens: null,
  webSearch: false,
  color: null,
  ...over,
});
const create = (name = 'Writer', over: Partial<PresetData> = {}, position = 'a0') =>
  api('/api/presets', {
    method: 'POST',
    body: JSON.stringify({ name, data: data(over), position }),
  });
const listOf = async (a: typeof api) =>
  ((await (await a('/api/presets')).json()) as { presets: Preset[] }).presets;

beforeEach(async () => {
  t = await createTestApp();
  cookie = (await setupOwner(t)).cookie;
  api = authed(t, cookie);
});
afterEach(() => t.close());

test('names and data are sealed under the row id', async () => {
  const preset = (await (
    await create('Secret name', { systemPrompt: 'Secret prompt' })
  ).json()) as Preset;
  const row = t.c.db.raw.prepare('SELECT name, data FROM presets WHERE id = ?').get(preset.id) as {
    name: Buffer;
    data: Buffer;
  };
  expect(row.name.toString('utf8')).not.toContain('Secret');
  expect(row.data.toString('utf8')).not.toContain('Secret');
  const { dek } = authContextFor(t, cookie);
  expect(openText(dek, row.name, aad('presets', 'name', preset.id))).toBe('Secret name');
  expect(openJson<PresetData>(dek, row.data, aad('presets', 'data', preset.id)).systemPrompt).toBe(
    'Secret prompt',
  );
});

test('lists in position order, updates and deletes', async () => {
  const b = (await (await create('B', {}, 'a1')).json()) as Preset;
  await create('A', {}, 'a0');
  expect((await listOf(api)).map((p) => p.name)).toEqual(['A', 'B']);
  const patched = await api(`/api/presets/${b.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'B2', data: data({ temperature: 0.5, color: 'mint' }) }),
  });
  expect(patched.status).toBe(200);
  expect(((await patched.json()) as Preset).data.temperature).toBe(0.5);
  expect((await api(`/api/presets/${b.id}`, { method: 'DELETE' })).status).toBe(204);
  expect(await listOf(api)).toHaveLength(1);
});

test('rejects a blank name and an oversize prompt', async () => {
  expect((await create('  ')).status).toBe(400);
  expect((await create('x', { systemPrompt: 'x'.repeat(20_001) })).status).toBe(400);
});

test('other users cannot read, change or delete a preset', async () => {
  const preset = (await (await create()).json()) as Preset;
  const other = authed(t, (await addUser(t, 'mira')).cookie);
  expect(await listOf(other)).toEqual([]);
  const patch = await other(`/api/presets/${preset.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'x' }),
  });
  expect(patch.status).toBe(404);
  expect((await other(`/api/presets/${preset.id}`, { method: 'DELETE' })).status).toBe(404);
  expect(await listOf(api)).toHaveLength(1);
});
