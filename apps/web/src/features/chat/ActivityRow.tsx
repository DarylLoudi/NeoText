import { useState } from 'react';
import { useT } from '../../lib/i18n';
import type { LiveGeneration } from '../../state/generations';
import { Spinner } from '../../ui';
import styles from './ActivityRow.module.css';
import { Elapsed } from './Elapsed';

export interface ActivityRowProps {
  /** What the generation is doing between pieces of text; only shown while it streams. */
  activity: LiveGeneration['activity'];
  streaming: boolean;
  /** Web searches the finished answer made (`usage.webSearchRequests`). */
  searches: number;
}

/**
 * "Searching the web…" while it happens, with the time it has taken so far so a long step does
 * not look stuck, then one quiet line saying how often it searched.
 */
export function ActivityRow({ activity, streaming, searches }: ActivityRowProps) {
  const t = useT();
  // Mounted when an activity starts (keyed by it), so the count starts there.
  const [since] = useState(Date.now);
  if (streaming) {
    if (activity === 'idle') return null;
    return (
      <p className={styles.row} role="status">
        <Spinner size={14} />
        {activity === 'searching' ? t('chat.activity.searching') : t('chat.activity.working')}
        <Elapsed since={since} className={styles.elapsed} />
      </p>
    );
  }
  if (searches <= 0) return null;
  return <p className={styles.done}>{t('chat.activity.searched', { count: searches })}</p>;
}
