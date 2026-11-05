import type { ReactNode } from 'react';
import styles from './AuthLayout.module.css';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className={styles.page}>
      <div className={styles.column}>
        <div className={styles.brand}>
          <span className={styles.wordmark}>neotext</span>
          <span className={styles.caret} aria-hidden="true" />
        </div>
        {children}
      </div>
    </main>
  );
}
