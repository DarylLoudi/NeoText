import { FLUSH_DELAY_MS } from '../lib/persist/outbox';

/** Signals to other tabs go out at most once per this interval, however many edits it holds. */
export const SIGNAL_INTERVAL_MS = FLUSH_DELAY_MS;
/**
 * Another tab's signals are answered once they have been quiet this long. It is longer than the
 * sending interval, so a steady stream of batched signals still ends in a single read.
 */
export const REFETCH_DEBOUNCE_MS = 400;

/** Cross-tab signal for one user's settings: BroadcastChannel, or a `storage` event without it. */
export function openSettingsSignals(userId: string, onChanged: () => void) {
  const storageKey = `neotext:settings-changed:${userId}`;
  let channel: BroadcastChannel | null = null;
  try {
    channel =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel(`neotext-settings:${userId}`);
  } catch {
    channel = null;
  }

  let refetchTimer: ReturnType<typeof setTimeout> | null = null;
  const received = () => {
    if (refetchTimer !== null) clearTimeout(refetchTimer);
    refetchTimer = setTimeout(() => {
      refetchTimer = null;
      onChanged();
    }, REFETCH_DEBOUNCE_MS);
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === storageKey) received();
  };
  if (channel) channel.onmessage = received;
  else window.addEventListener('storage', onStorage);

  const post = () => {
    try {
      if (channel) channel.postMessage('changed');
      else localStorage.setItem(storageKey, `${Date.now()}:${Math.random()}`);
    } catch {
      // No way to reach other tabs; they catch up on their next load or edit.
    }
  };
  let sendTimer: ReturnType<typeof setTimeout> | null = null;
  /** Edits in one interval share one signal: other tabs read the result once, not per edit. */
  const send = () => {
    if (sendTimer !== null) return;
    sendTimer = setTimeout(() => {
      sendTimer = null;
      post();
    }, SIGNAL_INTERVAL_MS);
  };
  /** A signal still waiting goes out now, so other tabs learn of this tab's last edits. */
  const flush = () => {
    if (sendTimer === null) return;
    clearTimeout(sendTimer);
    sendTimer = null;
    post();
  };
  // A tab closed within one interval of an edit never sees its timer fire.
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', onVisibility);
  const close = () => {
    flush();
    window.removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', onVisibility);
    if (refetchTimer !== null) clearTimeout(refetchTimer);
    refetchTimer = null;
    channel?.close();
    window.removeEventListener('storage', onStorage);
  };
  return { send, close };
}
