import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { activePersistence, closeUserPersistence, openUserPersistence } from './db';
import { clearDraft, DRAFT_SAVE_DELAY_MS, flushDrafts, loadDraft, saveDraft } from './drafts';

const stored = async (key: string) => (await activePersistence()).draftGet(key);

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  await openUserPersistence('u1');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(async () => {
  await flushDrafts();
  vi.useRealTimers();
  closeUserPersistence();
});

test('saves after 300 ms; empty deletes; survives store reopen', async () => {
  expect(DRAFT_SAVE_DELAY_MS).toBe(300);
  saveDraft('c1', 'hel');
  saveDraft('c1', 'hello');
  vi.advanceTimersByTime(299);
  expect(await stored('c1')).toBeUndefined();
  vi.advanceTimersByTime(1);
  await vi.waitFor(async () => expect(await stored('c1')).toBe('hello'));

  closeUserPersistence();
  await openUserPersistence('u1');
  expect(await loadDraft('c1')).toBe('hello');

  saveDraft('c1', '');
  vi.advanceTimersByTime(300);
  await vi.waitFor(async () => expect(await stored('c1')).toBeUndefined());
  expect(await loadDraft('c1')).toBe('');
});

test('a draft not yet written is still what loadDraft returns', async () => {
  saveDraft('new', 'typing');
  expect(await loadDraft('new')).toBe('typing');
  expect(await loadDraft('other')).toBe('');
});

test('clearDraft cancels a pending save and deletes the stored one', async () => {
  saveDraft('c2', 'first');
  await flushDrafts();
  expect(await stored('c2')).toBe('first');
  saveDraft('c2', 'second');
  await clearDraft('c2');
  vi.advanceTimersByTime(300);
  await flushDrafts();
  expect(await stored('c2')).toBeUndefined();
  expect(await loadDraft('c2')).toBe('');
});

test('leaving the page writes pending drafts right away', async () => {
  saveDraft('c3', 'unsaved');
  window.dispatchEvent(new Event('pagehide'));
  await vi.waitFor(async () => expect(await stored('c3')).toBe('unsaved'));
});

test('drafts are kept per key', async () => {
  saveDraft('a', 'one');
  saveDraft('b', 'two');
  await flushDrafts();
  expect(await loadDraft('a')).toBe('one');
  expect(await loadDraft('b')).toBe('two');
});

test('drafts belong to the signed-in user', async () => {
  saveDraft('new', 'secret from u1');
  await flushDrafts();
  closeUserPersistence();
  await openUserPersistence('u2');
  expect(await loadDraft('new')).toBe('');
  closeUserPersistence();
  await openUserPersistence('u1');
  expect(await loadDraft('new')).toBe('secret from u1');
});

test('a debounced draft lands in the store of the user who typed it', async () => {
  saveDraft('new', 'typed by u1');
  closeUserPersistence();
  await openUserPersistence('u2');
  vi.advanceTimersByTime(300);
  await flushDrafts();
  expect(await loadDraft('new')).toBe('');
  closeUserPersistence();
  await openUserPersistence('u1');
  expect(await loadDraft('new')).toBe('typed by u1');
});

test('a draft read before the store opens waits for it, as on a reload', async () => {
  saveDraft('c4', 'kept over a reload');
  await flushDrafts();
  closeUserPersistence();
  // The composer asks first; the session opens the store a moment later.
  const read = loadDraft('c4');
  await openUserPersistence('u1');
  expect(await read).toBe('kept over a reload');
});
