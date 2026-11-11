import { useT } from '../../lib/i18n';
import styles from './ProjectPanel.module.css';

export interface ConsoleLine {
  level: 'log' | 'info' | 'warn' | 'error';
  text: string;
}

/** What the page logged, collapsed under a count of its errors. */
export function ConsoleStrip({ lines }: { lines: ConsoleLine[] }) {
  const t = useT();
  const errors = lines.filter((l) => l.level === 'error').length;
  return (
    <details className={styles.console}>
      <summary className={styles.consoleSummary}>
        {t('chat.project.console')}
        {errors > 0 ? (
          <span className={styles.errorCount}>{t('chat.project.errors', { count: errors })}</span>
        ) : null}
      </summary>
      {lines.length === 0 ? (
        <p className={styles.consoleEmpty}>{t('chat.project.consoleEmpty')}</p>
      ) : (
        <ol className={styles.consoleLines}>
          {lines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only
            <li key={i} data-level={line.level} dir="auto">
              {line.text}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
