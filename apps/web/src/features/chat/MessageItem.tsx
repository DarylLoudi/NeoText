import type { ReactNode } from 'react';
import styles from './MessageItem.module.css';

export interface MessageItemProps {
  kind: 'user' | 'assistant';
  /** Who spoke, for assistive tech; nothing names the speaker visually. */
  label: string;
  /** Details under the text, such as model, time and cost. */
  meta?: ReactNode;
  children: ReactNode;
}

/**
 * One turn of the transcript in a single reading-width column: your messages sit on the right
 * as a bubble, answers run full width with their details in a quiet line underneath.
 */
export function MessageItem({ kind, label, meta, children }: MessageItemProps) {
  return (
    <article className={styles.item} data-turn="" data-role={kind} aria-label={label}>
      <div className={styles.body}>
        {children}
        {meta ? <div className={styles.meta}>{meta}</div> : null}
      </div>
    </article>
  );
}
