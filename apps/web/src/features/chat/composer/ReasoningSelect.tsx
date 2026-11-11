import type { ModelInfo } from '@neotext/shared';
import { useT } from '../../../lib/i18n';
import { Select } from '../../../ui/Select/Select';
import styles from './ComposerToolbar.module.css';
import { type EffortChoice, effortFor } from './reasoning-effort';

export interface ReasoningSelectProps {
  /** Null when the model cannot reason: nothing is shown. */
  reasoning: ModelInfo['reasoning'];
  value: EffortChoice;
  onChange: (value: EffortChoice) => void;
}

export function ReasoningSelect({ reasoning, value, onChange }: ReasoningSelectProps) {
  const t = useT();
  if (!reasoning || reasoning.efforts.length === 0) return null;
  const options = (['auto', ...reasoning.efforts] as EffortChoice[]).map((effort) => ({
    value: effort,
    label: t(`chat.composer.effort.${effort}`),
  }));
  return (
    <Select
      aria-label={t('chat.composer.reasoning')}
      triggerPrefix={t('chat.composer.reasoning')}
      triggerClassName={styles.select}
      value={effortFor(reasoning, value)}
      onChange={(next) => onChange(next as EffortChoice)}
      options={options}
    />
  );
}
