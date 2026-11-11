import { type ModelRef, modelKey } from '@neotext/shared';
import { Plus, X } from '@phosphor-icons/react';
import * as Popover from 'radix-ui/popover';
import { useCallback, useState } from 'react';
import { useT } from '../../lib/i18n';
import { Button, IconButton } from '../../ui';
import { ModelList } from '../chat/composer/ModelList';
import pickerStyles from '../chat/composer/ModelPicker.module.css';
import { useModels } from '../chat/composer/use-models';
import { warmProvider } from '../chat/composer/warm';
import { shortModelName } from '../chat/thread';
import styles from './ComparePicker.module.css';
import { MAX_COMPARE } from './compare-state';

export interface ComparePickerProps {
  /** The models chosen, in the order their columns appear. */
  value: readonly ModelRef[];
  onChange: (refs: ModelRef[]) => void;
}

/**
 * The models a compare turn goes to: one chip per model, and a popover with the model list
 * where a pick adds a model (up to four) and picking a chosen one again removes it.
 */
export function ComparePicker({ value, onChange }: ComparePickerProps) {
  const t = useT();
  const catalog = useModels();
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const nameOf = (ref: ModelRef) =>
    catalog.byKey.get(modelKey(ref))?.name ?? shortModelName(ref.modelId);

  const pick = useCallback(
    (ref: ModelRef) => {
      const key = modelKey(ref);
      if (value.some((r) => modelKey(r) === key)) {
        // At least one model stays chosen.
        if (value.length <= 1) return;
        setFull(false);
        onChange(value.filter((r) => modelKey(r) !== key));
        return;
      }
      if (value.length >= MAX_COMPARE) {
        setFull(true);
        return;
      }
      warmProvider(ref.providerId);
      onChange([...value, ref]);
    },
    [value, onChange],
  );
  const leave = useCallback(() => setOpen(false), []);

  return (
    <div className={styles.chips}>
      <span className={styles.label}>{t('chat.compare.with')}</span>
      {value.map((ref) => {
        const name = nameOf(ref);
        return (
          <span key={modelKey(ref)} className={styles.chip}>
            <span className={styles.chipName} dir="auto">
              {name}
            </span>
            {value.length > 1 ? (
              <IconButton
                size="sm"
                className={styles.remove}
                label={t('chat.compare.remove', { model: name })}
                icon={<X />}
                onClick={() => onChange(value.filter((r) => modelKey(r) !== modelKey(ref)))}
              />
            ) : null}
          </span>
        );
      })}
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setFull(false);
        }}
      >
        <Popover.Trigger asChild>
          <Button size="sm" variant="ghost" className={styles.add}>
            <Plus aria-hidden />
            {t('chat.compare.add')}
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className={pickerStyles.content}
            side="top"
            align="start"
            sideOffset={6}
            collisionPadding={8}
            aria-label={t('chat.compare.pickerLabel')}
          >
            <p className={styles.count} aria-live="polite">
              {full
                ? t('chat.compare.limit', { count: MAX_COMPARE })
                : t('chat.compare.chosen', { count: value.length, max: MAX_COMPARE })}
            </p>
            <ModelList value={value[0] ?? null} onPick={pick} onLeave={leave} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
