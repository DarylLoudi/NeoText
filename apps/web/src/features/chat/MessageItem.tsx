import type { ReactNode } from 'react';
import styles from './MessageItem.module.css';

export interface MessageItemProps {
  kind: 'user' | 'assistant';
  /** Who spoke, for assistive tech (the gutter shows it visually). */
  label: string;
  /** The speaker gutter: name, then details such as time and cost. */
  speaker: ReactNode;
  children: ReactNode;
}

/**
 * One turn of the transcript (spec 12.1): the speaker in a right-aligned gutter, the text in a
 * reading-width column beside it. Below 768 px the speaker sits above the text.
 */
export function MessageItem({ kind, label, speaker, children }: MessageItemProps) {
  return (
    <article className={styles.item} data-turn="" data-role={kind} aria-label={label}>
      <div className={styles.gutter}>{speaker}</div>
      <div className={styles.body}>{children}</div>
    </article>
  );
}
