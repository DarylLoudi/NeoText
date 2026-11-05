import { Columns } from '@phosphor-icons/react';
import { useT } from '../../lib/i18n';
import { Tooltip } from '../../ui';
import styles from './ComparePicker.module.css';

export interface CompareToggleProps {
  on: boolean;
  onToggle: () => void;
  /** Why compare cannot be used right now; the toggle is then off and inert. */
  blockedBy?: string | null;
}

/** The composer toolbar's "Compare": sends the next message to several models at once. */
export function CompareToggle({ on, onToggle, blockedBy = null }: CompareToggleProps) {
  const t = useT();
  const button = (
    <button
      type="button"
      className={styles.toggle}
      aria-pressed={on}
      // Not `disabled`, so it stays focusable and its tooltip says why.
      aria-disabled={blockedBy ? true : undefined}
      onClick={blockedBy ? undefined : onToggle}
    >
      <Columns aria-hidden className={styles.icon} weight={on ? 'bold' : 'regular'} />
      {t('chat.compare.toggle')}
    </button>
  );
  return blockedBy ? <Tooltip content={blockedBy}>{button}</Tooltip> : button;
}
