import type { ModelInfo, ReasoningEffort } from '@neotext/shared';
import { useT } from '../../../lib/i18n';
import { Select } from '../../../ui';
import styles from './ComposerToolbar.module.css';

/** `auto` leaves the choice to the model; anything else is sent as the effort. */
export type EffortChoice = 'auto' | ReasoningEffort;

export interface ReasoningSelectProps {
  /** Null when the model cannot reason: nothing is shown. */
  reasoning: ModelInfo['reasoning'];
  value: EffortChoice;
  onChange: (value: EffortChoice) => void;
}

/** The choice to use for a model: `wanted` if the model offers it, else `auto`. */
export function effortFor(reasoning: ModelInfo['reasoning'], wanted: EffortChoice): EffortChoice {
  return reasoning && wanted !== 'auto' && reasoning.efforts.includes(wanted) ? wanted : 'auto';
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
