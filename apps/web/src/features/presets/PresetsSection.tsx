import type { Preset } from '@neotext/shared';
import { DotsThree, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { useT } from '../../lib/i18n';
import { Button, Dialog, IconButton, Menu, type MenuItem, Spinner } from '../../ui';
import { moveMenuItems } from '../sidebar/ConversationItem';
import { stepPosition } from '../sidebar/reorder';
import { LazyPresetEditor } from './LazyPresetEditor';
import styles from './PresetsSection.module.css';
import { useStartPreset } from './start-preset';
import { usePresetMutations, usePresets } from './use-presets';

interface RowProps {
  preset: Preset;
  upKey: string | null;
  downKey: string | null;
  onEdit: () => void;
  onStart: () => void;
}

function PresetRow({ preset, upKey, downKey, onEdit, onStart }: RowProps) {
  const t = useT();
  const mutations = usePresetMutations();
  const [confirming, setConfirming] = useState(false);
  const items: MenuItem[] = [
    { label: t('sidebar.presets.edit'), icon: <PencilSimple />, onSelect: onEdit },
    ...moveMenuItems(
      {
        up: upKey === null ? null : () => void mutations.update(preset.id, { position: upKey }),
        down:
          downKey === null ? null : () => void mutations.update(preset.id, { position: downKey }),
      },
      t,
    ),
    { separator: true },
    {
      label: t('sidebar.presets.delete'),
      icon: <Trash />,
      danger: true,
      onSelect: () => setConfirming(true),
    },
  ];
  return (
    <li className={styles.row}>
      <button type="button" className={styles.start} onClick={onStart}>
        <span className={styles.dot} data-accent={preset.data.color ?? undefined} aria-hidden />
        <span className={styles.name} dir="auto">
          {preset.name}
        </span>
      </button>
      <span className={styles.menu}>
        <Menu
          align="end"
          items={items}
          trigger={
            <IconButton
              size="sm"
              label={t('sidebar.presets.options', { name: preset.name })}
              icon={<DotsThree />}
            />
          }
        />
      </span>
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        size="sm"
        title={t('sidebar.presets.deleteTitle', { name: preset.name })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirming(false);
                void mutations.remove(preset.id);
              }}
            >
              {t('sidebar.presets.delete')}
            </Button>
          </>
        }
      >
        <p>{t('sidebar.presets.deleteBody')}</p>
      </Dialog>
    </li>
  );
}

/** Sidebar section: click a preset to start a new chat with it. */
export function PresetsSection() {
  const t = useT();
  const start = useStartPreset();
  const presets = usePresets();
  /** `null` while closed, `'new'` for a blank editor, else the preset being edited. */
  const [editing, setEditing] = useState<Preset | 'new' | null>(null);

  if (presets.isPending) {
    return (
      <p className={styles.note}>
        <Spinner label={t('common.loading')} size={12} />
      </p>
    );
  }
  if (presets.isError) return <p className={styles.note}>{t('sidebar.presets.loadFailed')}</p>;
  const list = presets.data;
  const positions = list.map((p) => p.position);

  return (
    <>
      {list.length === 0 ? (
        <p className={styles.note}>{t('sidebar.presets.empty')}</p>
      ) : (
        <ul className={styles.list} aria-label={t('sidebar.presets.list')}>
          {list.map((preset, i) => (
            <PresetRow
              key={preset.id}
              preset={preset}
              upKey={stepPosition(positions, i, -1)}
              downKey={stepPosition(positions, i, 1)}
              onEdit={() => setEditing(preset)}
              onStart={() => start(preset)}
            />
          ))}
        </ul>
      )}
      <Button size="sm" variant="ghost" className={styles.add} onClick={() => setEditing('new')}>
        <Plus aria-hidden /> {t('sidebar.presets.new')}
      </Button>
      {editing !== null ? (
        <LazyPresetEditor
          open
          preset={editing === 'new' ? null : editing}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}
