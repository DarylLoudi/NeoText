import type { Preset } from '@neotext/shared';
import { Lightning } from '@phosphor-icons/react';
import { useState } from 'react';
import { useT } from '../../lib/i18n';
import { Menu, type MenuItem } from '../../ui';
import { LazyPresetEditor } from '../presets/LazyPresetEditor';
import { useStartPreset } from '../presets/start-preset';
import { usePresets } from '../presets/use-presets';
import styles from './Sidebar.module.css';

/** The "Presets" quick action: a menu of presets (each starts a chat with it) and "New preset". */
export function PresetsQuickAction() {
  const t = useT();
  const presets = usePresets();
  const start = useStartPreset();
  const [creating, setCreating] = useState(false);
  const list: Preset[] = presets.data ?? [];
  const items: MenuItem[] = [
    ...list.map((preset) => ({ id: preset.id, label: preset.name, onSelect: () => start(preset) })),
    ...(list.length > 0 ? [{ separator: true } as const] : []),
    { id: 'new', label: t('sidebar.presets.new'), onSelect: () => setCreating(true) },
  ];
  return (
    <>
      <Menu
        items={items}
        trigger={
          <button type="button" className={styles.action}>
            <Lightning className={styles.actionIcon} aria-hidden />
            {t('sidebar.presets.menu')}
          </button>
        }
      />
      {creating ? <LazyPresetEditor open preset={null} onOpenChange={setCreating} /> : null}
    </>
  );
}
