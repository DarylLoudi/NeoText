import { useEffect, useRef, useState } from 'react';
import { useT } from '../../lib/i18n';
import { Button, toast } from '../../ui';
import styles from './RecoveryKeyPanel.module.css';
import { StepHeading } from './StepHeading';

export interface RecoveryKeyPanelProps {
  recoveryKey: string;
  title: string;
  body: string;
  onContinue: () => void;
  busy?: boolean;
}

export const RECOVERY_KEY_FILE = 'neotext-recovery-key.txt';

export function RecoveryKeyPanel({
  recoveryKey,
  title,
  body,
  onContinue,
  busy = false,
}: RecoveryKeyPanelProps) {
  const t = useT();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  // A refresh would lose a key the user has not yet confirmed saving.
  useEffect(() => {
    if (saved) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [saved]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ message: t('auth.copyFailed'), tone: 'danger' });
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([`${recoveryKey}\n`], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = RECOVERY_KEY_FILE;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className={styles.panel}>
      <StepHeading focusOnMount>{title}</StepHeading>
      <p>{body}</p>
      <div>
        <p className={styles.label}>{t('auth.recoveryKeyLabel')}</p>
        <code className={styles.key}>{recoveryKey}</code>
      </div>
      <div className={styles.actions}>
        <Button onClick={copy}>{copied ? t('common.copied') : t('common.copy')}</Button>
        <Button onClick={download}>{t('auth.recoveryKeyDownload')}</Button>
      </div>
      <p className={styles.honest}>{t('auth.recoveryKeyHonest')}</p>
      <label className={styles.ack}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>{t('auth.recoveryKeySaved')}</span>
      </label>
      <div>
        <Button variant="primary" disabled={!saved} loading={busy} onClick={onContinue}>
          {t('auth.recoveryKeyContinue')}
        </Button>
      </div>
    </section>
  );
}
