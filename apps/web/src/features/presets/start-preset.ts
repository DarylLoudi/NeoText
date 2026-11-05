import type { Preset } from '@neotext/shared';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { setPendingPreset } from './use-presets';

/** Starts a new chat with the preset; the same for the sidebar section and the quick action. */
export function useStartPreset(): (preset: Preset) => void {
  const navigate = useNavigate();
  return useCallback(
    (preset) => {
      setPendingPreset(preset);
      void navigate({ to: '/' });
    },
    [navigate],
  );
}
