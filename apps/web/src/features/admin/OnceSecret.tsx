import { useEffect, useRef, useState } from 'react';
import { useT } from '../../lib/i18n';
import { Button, toast } from '../../ui';
import styles from './AdminPages.module.css';

/** A code or password the server returns once: shown large, with Copy, then gone. */
export function OnceSecret({ label, value }: { label: string; value: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ message: t('auth.copyFailed'), tone: 'danger' });
    }
  }

  return (
    <div className={styles.secret}>
      <p className={styles.secretLabel}>{label}</p>
      <div className={styles.secretRow}>
        <code className={styles.secretValue}>{value}</code>
        <Button size="sm" onClick={copy}>
          {copied ? t('common.copied') : t('common.copy')}
        </Button>
      </div>
    </div>
  );
}
