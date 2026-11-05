import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';

export type EmptyStateProps = { title: string; body?: string; action?: ReactNode };

export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <h2 className={styles.title}>{title}</h2>
      {body ? <p className={styles.body}>{body}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
