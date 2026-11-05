import { afterEach, expect, test, vi } from 'vitest';
import { openSettingsSignals, REFETCH_DEBOUNCE_MS, SIGNAL_INTERVAL_MS } from './settings-signals';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const opened: { close(): void }[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) s.close();
  vi.unstubAllGlobals();
});

function open(userId: string, onChanged: () => void = () => {}) {
  const s = openSettingsSignals(userId, onChanged);
  opened.push(s);
  return s;
}

/** Counts the raw messages other tabs would see on the user's channel. */
function listen(userId: string) {
  const seen = { count: 0 };
  const channel = new BroadcastChannel(`neotext-settings:${userId}`);
  channel.onmessage = () => {
    seen.count += 1;
  };
  opened.push(channel);
  return seen;
}

test('a burst of sends reaches other tabs as one message per interval', async () => {
  const seen = listen('u1');
  const tab = open('u1');
  for (let i = 0; i < 50; i += 1) tab.send();
  await wait(SIGNAL_INTERVAL_MS + 100);
  expect(seen.count).toBe(1);
  // A later edit is still announced.
  tab.send();
  await wait(SIGNAL_INTERVAL_MS + 100);
  expect(seen.count).toBe(2);
});

test('a burst of messages from another tab is answered with one refetch, after it ends', async () => {
  const onChanged = vi.fn();
  open('u1', onChanged);
  const other = new BroadcastChannel('neotext-settings:u1');
  opened.push(other);
  for (let i = 0; i < 50; i += 1) other.postMessage('changed');
  await wait(50);
  expect(onChanged).not.toHaveBeenCalled();
  await wait(REFETCH_DEBOUNCE_MS + 100);
  expect(onChanged).toHaveBeenCalledTimes(1);
});

test("another user's messages are ignored", async () => {
  const onChanged = vi.fn();
  open('u1', onChanged);
  const other = new BroadcastChannel('neotext-settings:u2');
  opened.push(other);
  other.postMessage('changed');
  await wait(REFETCH_DEBOUNCE_MS + 100);
  expect(onChanged).not.toHaveBeenCalled();
});

test('a send still waiting goes out when the tab closes its signals', async () => {
  const seen = listen('u1');
  const tab = openSettingsSignals('u1', () => {});
  tab.send();
  tab.close();
  await wait(50);
  expect(seen.count).toBe(1);
});

test('without BroadcastChannel, storage events carry the signal, batched the same way', async () => {
  vi.stubGlobal('BroadcastChannel', undefined);
  const setItem = vi.spyOn(Storage.prototype, 'setItem');
  const onChanged = vi.fn();
  const tab = open('u1', onChanged);
  for (let i = 0; i < 50; i += 1) tab.send();
  await wait(SIGNAL_INTERVAL_MS + 100);
  expect(setItem.mock.calls.filter(([k]) => k === 'neotext:settings-changed:u1')).toHaveLength(1);
  for (let i = 0; i < 20; i += 1) {
    window.dispatchEvent(new StorageEvent('storage', { key: 'neotext:settings-changed:u1' }));
  }
  await wait(REFETCH_DEBOUNCE_MS + 100);
  expect(onChanged).toHaveBeenCalledTimes(1);
  setItem.mockRestore();
});

test('a pending send goes out at once when the page is hidden for good (pagehide)', async () => {
  const seen = listen('u1');
  const tab = open('u1');
  tab.send();
  window.dispatchEvent(new Event('pagehide'));
  await wait(50);
  expect(seen.count).toBe(1);
  // The flushed signal is not sent a second time when its timer would have fired.
  await wait(SIGNAL_INTERVAL_MS + 100);
  expect(seen.count).toBe(1);
});

test('a pending send goes out at once when the tab becomes hidden, not when it becomes visible', async () => {
  const seen = listen('u1');
  const tab = open('u1');
  const state = vi.spyOn(document, 'visibilityState', 'get');
  state.mockReturnValue('visible');
  tab.send();
  document.dispatchEvent(new Event('visibilitychange'));
  await wait(50);
  expect(seen.count).toBe(0);
  state.mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  await wait(50);
  expect(seen.count).toBe(1);
  state.mockRestore();
});

test('hiding the page with nothing pending sends nothing', async () => {
  const seen = listen('u1');
  open('u1');
  window.dispatchEvent(new Event('pagehide'));
  await wait(50);
  expect(seen.count).toBe(0);
});

test('closing the signals removes the page listeners', () => {
  const removeWindow = vi.spyOn(window, 'removeEventListener');
  const removeDocument = vi.spyOn(document, 'removeEventListener');
  openSettingsSignals('u1', () => {}).close();
  expect(removeWindow.mock.calls.map(([type]) => type)).toContain('pagehide');
  expect(removeDocument.mock.calls.map(([type]) => type)).toContain('visibilitychange');
  removeWindow.mockRestore();
  removeDocument.mockRestore();
});
