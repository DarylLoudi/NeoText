import { Columns } from '@phosphor-icons/react';
import { useT } from '../../lib/i18n';
import styles from './ComparePicker.module.css';

export interface CompareToggleProps {
  on: boolean;
  onToggle: () => void;
}

/** The composer toolbar's "Compare": sends the next message to several models at once. */
export function CompareToggle({ on, onToggle }: CompareToggleProps) {
  const t = useT();
  return (
    <button type="button" className={styles.toggle} aria-pressed={on} onClick={onToggle}>
      <Columns aria-hidden className={styles.icon} weight={on ? 'bold' : 'regular'} />
      {t('chat.compare.toggle')}
    </button>
  );
}
