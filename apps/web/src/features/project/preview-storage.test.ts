import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { activePersistence, closeUserPersistence, openUserPersistence } from '../../lib/persist/db';
import {
  clearPreviewStorage,
  flushPreviewStorage,
  forgetPreviewStorage,
  loadPreviewStorage,
  savePreviewStorage,
} from './preview-storage';

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  await openUserPersistence('u1');
});
afterEach(() => closeUserPersistence());

test('keeps a chat preview data across a reopen, apart from other chats', async () => {
  savePreviewStorage('c1', { todos: '["a"]' });
  savePreviewStorage('c2', { other: '1' });
  await flushPreviewStorage();
  closeUserPersistence();
  await openUserPersistence('u1');
  expect(await loadPreviewStorage('c1')).toEqual({ todos: '["a"]' });
  expect(await loadPreviewStorage('c2')).toEqual({ other: '1' });
});

test('the last save wins, and clearing empties it', async () => {
  savePreviewStorage('c1', { n: '1' });
  savePreviewStorage('c1', { n: '2' });
  await flushPreviewStorage();
  expect(await loadPreviewStorage('c1')).toEqual({ n: '2' });
  await clearPreviewStorage('c1');
  expect(await loadPreviewStorage('c1')).toEqual({});
});

test('a chat with nothing saved starts empty', async () => {
  expect(await loadPreviewStorage('nope')).toEqual({});
});

test('forgetting deleted chats removes their data and drops saves still waiting', async () => {
  savePreviewStorage('c1', { a: '1' });
  savePreviewStorage('c2', { b: '2' });
  await flushPreviewStorage();
  savePreviewStorage('c1', { a: 'late' });
  await forgetPreviewStorage(['c1']);
  await flushPreviewStorage();
  const db = await activePersistence();
  expect(await db.getKV('preview-storage:c1')).toBeUndefined();
  expect(await loadPreviewStorage('c2')).toEqual({ b: '2' });
});
