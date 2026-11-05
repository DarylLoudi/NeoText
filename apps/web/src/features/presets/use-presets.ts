import type { CreatePresetBody, Preset, UpdatePresetBody } from '@neotext/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { presetsApi } from '../../lib/api/presets';
import { qk } from '../../lib/query';
import { toast } from '../../ui';
import { errorMessage, positionAfter } from '../sidebar/use-conversations';

export function usePresets() {
  return useQuery({ queryKey: qk.presets, queryFn: presetsApi.list });
}

export interface PresetMutations {
  /** The saved preset, or null after a toast explained the failure. */
  create(body: Omit<CreatePresetBody, 'position'>): Promise<Preset | null>;
  update(id: string, body: UpdatePresetBody): Promise<Preset | null>;
  remove(id: string): Promise<boolean>;
}

export function usePresetMutations(): PresetMutations {
  const qc = useQueryClient();
  return useMemo(() => {
    const refresh = () => qc.invalidateQueries({ queryKey: qk.presets });
    async function attempt<T>(run: () => Promise<T>, fail: T): Promise<T> {
      try {
        return await run();
      } catch (err) {
        toast({ message: errorMessage(err), tone: 'danger' });
        return fail;
      } finally {
        void refresh();
      }
    }
    return {
      create: (body) =>
        attempt(async () => {
          const all = qc.getQueryData<Preset[]>(qk.presets) ?? [];
          return presetsApi.create({
            ...body,
            position: positionAfter(all.map((p) => p.position)),
          });
        }, null),
      update: (id, body) => attempt(() => presetsApi.update(id, body), null),
      remove: (id) =>
        attempt(async () => {
          await presetsApi.remove(id);
          return true;
        }, false),
    };
  }, [qc]);
}

/* ----------------------------------------------------------------------------------------------
 * The preset a new chat starts with. Picking one in the sidebar sets it and goes to the new chat;
 * the first send takes it (and the chat keeps it from then on, on the server).
 * --------------------------------------------------------------------------------------------*/

let pending: Preset | null = null;
const listeners = new Set<() => void>();

export function setPendingPreset(preset: Preset | null): void {
  pending = preset;
  for (const l of listeners) l();
}

export function getPendingPreset(): Preset | null {
  return pending;
}

export function usePendingPreset(): Preset | null {
  const subscribe = useCallback((l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => pending,
    () => null,
  );
}
