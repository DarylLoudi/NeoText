import type { JsonObject } from '@neotext/shared';
import { useEffect, useState } from 'react';
import { activePersistence } from '../../lib/persist/db';
import { REJECTED_KV_KEY, type RejectedPatch } from '../../lib/persist/outbox';
import { onSettingsRejected, updateSettings } from '../../state/settings';

const sameChange = (a: RejectedPatch, b: RejectedPatch): boolean =>
  JSON.stringify(a.patch) === JSON.stringify(b.patch);

async function readKept(): Promise<RejectedPatch[]> {
  try {
    const store = await activePersistence();
    return (await store.getKV<RejectedPatch[]>(REJECTED_KV_KEY)) ?? [];
  } catch {
    return [];
  }
}

async function writeKept(list: RejectedPatch[]): Promise<void> {
  try {
    const store = await activePersistence();
    await store.setKV(REJECTED_KV_KEY, list);
  } catch {
    // The list on screen is still right; only the copy kept for the next visit is stale.
  }
}

export interface RejectedChanges {
  items: RejectedPatch[];
  /** Sends the change again, and takes it off the list. */
  retry: (item: RejectedPatch) => void;
  dismiss: (item: RejectedPatch) => void;
}

/**
 * Changes the server refused for good: the ones kept from earlier visits, plus any that are
 * refused while this page is open.
 */
export function useRejectedChanges(): RejectedChanges {
  const [items, setItems] = useState<RejectedPatch[]>([]);

  useEffect(() => {
    let live = true;
    void readKept().then((kept) => {
      if (!live) return;
      setItems((now) => [...kept, ...now.filter((n) => !kept.some((k) => sameChange(k, n)))]);
    });
    const off = onSettingsRejected((err, patch: JsonObject) => {
      const item: RejectedPatch = { patch, code: err.code, message: err.message, at: Date.now() };
      setItems((now) => (now.some((n) => sameChange(n, item)) ? now : [...now, item]));
    });
    return () => {
      live = false;
      off();
    };
  }, []);

  const remove = (item: RejectedPatch) => {
    const rest = items.filter((n) => !sameChange(n, item));
    setItems(rest);
    void writeKept(rest);
  };

  return {
    items,
    retry: (item) => {
      remove(item);
      updateSettings(item.patch);
    },
    dismiss: remove,
  };
}
