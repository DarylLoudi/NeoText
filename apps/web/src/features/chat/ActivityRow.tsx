import { useT } from '../../lib/i18n';
import type { LiveGeneration } from '../../state/generations';
import { Spinner } from '../../ui';
import styles from './ActivityRow.module.css';

export interface ActivityRowProps {
  /** What the generation is doing between pieces of text; only shown while it streams. */
  activity: LiveGeneration['activity'];
  streaming: boolean;
  /** Web searches the finished answer made (`usage.webSearchRequests`). */
  searches: number;
}

/** "Searching the web…" while it happens, then one quiet line saying how often it did. */
export function ActivityRow({ activity, streaming, searches }: ActivityRowProps) {
  const t = useT();
  if (streaming) {
    if (activity === 'idle') return null;
    return (
      <p className={styles.row} role="status">
        <Spinner size={14} />
        {activity === 'searching' ? t('chat.activity.searching') : t('chat.activity.working')}
      </p>
    );
  }
  if (searches <= 0) return null;
  return <p className={styles.done}>{t('chat.activity.searched', { count: searches })}</p>;
}
