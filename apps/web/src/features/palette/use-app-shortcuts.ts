import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo } from 'react';
import { runAppCommand } from '../../lib/app-commands';
import { type ActionId, bindShortcuts } from '../../lib/hotkeys';
import { useSettings } from '../../state/settings';
import { setPendingPreset } from '../presets/use-presets';

/** Binds the app's shortcuts to the window while `enabled` (signed in, shell on the page). */
export function useAppShortcuts({
  enabled,
  togglePalette,
  toggleSearch,
}: {
  enabled: boolean;
  togglePalette: () => void;
  toggleSearch: () => void;
}): void {
  const navigate = useNavigate();
  const overrides = useSettings((s) => s.settings.shortcuts);
  // Settings are rebuilt on every change; only a different shortcut should rebind.
  const key = JSON.stringify(overrides);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `overrides`
  const stable = useMemo(() => overrides, [key]);

  useEffect(() => {
    if (!enabled) return;
    const handlers: Partial<Record<ActionId, () => void>> = {
      palette: togglePalette,
      search: toggleSearch,
      'new-chat': () => {
        setPendingPreset(null);
        void navigate({ to: '/' });
      },
      'toggle-sidebar': () => void runAppCommand('toggle-sidebar'),
      'focus-composer': () => void runAppCommand('focus-composer'),
      settings: () => void navigate({ to: '/settings/$section', params: { section: 'general' } }),
      'shortcuts-help': () =>
        void navigate({ to: '/settings/$section', params: { section: 'shortcuts' } }),
    };
    return bindShortcuts(handlers, stable);
  }, [enabled, togglePalette, toggleSearch, navigate, stable]);
}
