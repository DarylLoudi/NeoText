import { useT } from '../../lib/i18n';
import { Button } from '../../ui';
import styles from './PresetsSection.module.css';
import { setPendingPreset, usePendingPreset, usePresets } from './use-presets';

/** Shown in an empty chat's model sheet: the user's presets as starting points. */
export function PresetStarters() {
  const t = useT();
  const presets = usePresets();
  const active = usePendingPreset();
  const list = presets.data ?? [];
  if (list.length === 0) return null;
  return (
    <fieldset aria-label={t('sidebar.presets.startWith')} className={styles.starters}>
      {list.map((preset) => (
        <Button
          key={preset.id}
          size="sm"
          aria-pressed={active?.id === preset.id}
          onClick={() => setPendingPreset(active?.id === preset.id ? null : preset)}
        >
          {preset.name}
        </Button>
      ))}
    </fieldset>
  );
}
