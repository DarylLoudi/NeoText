import {
  applyMergePatch,
  defaultSettings,
  type JsonObject,
  parseSettings,
  type SettingsResponse,
  type UserSettings,
} from '@neotext/shared';
import { useSyncExternalStore } from 'react';
import { vi } from 'vitest';
import type { SettingsState } from '../state/settings';

/**
 * Stand-in for `src/state/settings` in component tests:
 * `vi.mock('../../state/settings', () => import('../../test/fake-settings'))`.
 * Edits apply in memory (merge patch, then lenient parsing) and are recorded on `updateSettings`.
 */
const initial = (): SettingsState => ({
  settings: defaultSettings(),
  version: 1,
  hydrated: true,
  recovered: false,
  resetPaths: [],
  durable: true,
});

let state = initial();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

/** Replaces part of the state; `settings` is a merge patch over the current settings. */
export function setFakeSettings(
  next: Partial<Omit<SettingsState, 'settings'>> & { settings?: JsonObject } = {},
): void {
  const { settings: patch, ...rest } = next;
  const settings: UserSettings = patch
    ? parseSettings(applyMergePatch(state.settings, patch)).settings
    : state.settings;
  state = { ...state, ...rest, settings };
  emit();
}

export function resetFakeSettings(): void {
  state = initial();
  updateSettings.mockClear();
  flushSettings.mockClear();
  refetchSettings.mockClear();
  emit();
}

export function getSettingsState(): SettingsState {
  return state;
}

export function subscribeSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSettings<T>(selector: (s: SettingsState) => T): T {
  return useSyncExternalStore(
    subscribeSettings,
    () => selector(state),
    () => selector(state),
  );
}

export const updateSettings = vi.fn((patch: JsonObject) => {
  setFakeSettings({ settings: patch });
});

export const hydrateSettings = vi.fn(async (_userId: string) => {});
export const flushSettings = vi.fn(async () => {});
export const refetchSettings = vi.fn(async () => {});
export const onServerSettings = vi.fn(
  (_fn: (next: SettingsResponse, previous: SettingsResponse | null) => void) => () => {},
);
export const teardownSettings = vi.fn(async () => {});
export const restoreSettingsVersion = vi.fn(async (_version: number) => {});
export const onSettingsRejected = vi.fn(() => () => {});
