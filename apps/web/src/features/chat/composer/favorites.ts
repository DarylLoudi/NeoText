import { useMemo } from 'react';
import { getSettingsState, updateSettings, useSettings } from '../../../state/settings';

/** The starred model keys, as a set that only changes when the list does. */
export function useFavorites(): ReadonlySet<string> {
  const joined = useSettings((s) => s.settings.models.favorites.join('\n'));
  return useMemo(() => new Set(joined ? joined.split('\n') : []), [joined]);
}

/** Stars a model, or takes the star away. The list is sent whole (a merge patch replaces arrays). */
export function toggleFavorite(key: string): void {
  const current = getSettingsState().settings.models.favorites;
  const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
  updateSettings({ models: { favorites: next } });
}
