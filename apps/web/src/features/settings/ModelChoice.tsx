import { type ModelRef, modelKey } from '@neotext/shared';
import { CaretDown } from '@phosphor-icons/react';
import { useId } from 'react';
import { useT } from '../../lib/i18n';
import { Button } from '../../ui';
import { ModelPicker } from '../chat/composer/ModelPicker';
import { useModels } from '../chat/composer/use-models';
import styles from './ModelChoice.module.css';

export interface ModelChoiceProps {
  label: string;
  value: ModelRef | null;
  onChange: (ref: ModelRef | null) => void;
  /** Said when nothing is chosen. */
  emptyText: string;
  clearLabel: string;
}

/** A model chosen from the same searchable list as in a chat; empty is a valid choice. */
export function ModelChoice({ label, value, onChange, emptyText, clearLabel }: ModelChoiceProps) {
  const t = useT();
  const catalog = useModels();
  const labelId = useId();
  const valueId = useId();
  const name = value ? (catalog.byKey.get(modelKey(value))?.name ?? value.modelId) : emptyText;
  return (
    <div className={styles.field}>
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      <div className={styles.line}>
        <ModelPicker value={value} onChange={onChange}>
          <button
            type="button"
            className={styles.trigger}
            aria-labelledby={`${labelId} ${valueId}`}
          >
            <span
              id={valueId}
              className={styles.value}
              data-empty={value ? undefined : ''}
              dir="auto"
            >
              {name}
            </span>
            <CaretDown className={styles.caret} aria-hidden />
          </button>
        </ModelPicker>
        {value ? (
          <Button size="sm" variant="ghost" aria-label={clearLabel} onClick={() => onChange(null)}>
            {t('settings.general.clear')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
