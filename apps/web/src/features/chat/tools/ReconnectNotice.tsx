import { useT } from '../../../lib/i18n';
import { Button } from '../../../ui';
import styles from './ReconnectNotice.module.css';

/** A call this page cannot tell the state of: says so, and tries to reach it again. */
export function ReconnectNotice({ onRetry }: { onRetry?: (() => void) | undefined }) {
  const t = useT();
  return (
    <div className={styles.notice}>
      <p role="alert">{t('chat.tools.unreachable')}</p>
      {onRetry ? (
        <Button size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      ) : null}
    </div>
  );
}
