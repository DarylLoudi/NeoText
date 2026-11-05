import { type FormEvent, useState } from 'react';
import { authApi } from '../../../lib/api/auth';
import { ApiError } from '../../../lib/api/client';
import { useT } from '../../../lib/i18n';
import { Button, Dialog, TextField } from '../../../ui';
import { FormError } from '../../auth/FormError';
import styles from './RotateRecoveryKey.module.css';

export interface RotateRecoveryKeyProps {
  /** Called with the new key once the server has made it. */
  onKey: (recoveryKey: string) => void;
}

/** The button, and the password prompt it opens. The key itself is shown by the caller. */
export function RotateRecoveryKey({ onKey }: RotateRecoveryKeyProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  function change(next: boolean) {
    setOpen(next);
    if (!next) {
      setPassword('');
      setError(undefined);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      const key = await authApi.rotateRecoveryKey({ password });
      change(false);
      onKey(key);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_credentials') {
        setError(t('auth.wrongPassword'));
      } else {
        setError(err instanceof ApiError ? err.message : t('common.genericError'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div>
        <Button onClick={() => change(true)}>{t('settings.security.makeKey')}</Button>
      </div>
      <Dialog
        open={open}
        onOpenChange={change}
        size="sm"
        title={t('settings.security.makeKey')}
        description={t('settings.security.makeKeyBody')}
      >
        <form className={styles.form} onSubmit={submit} noValidate>
          <TextField
            label={t('settings.security.yourPassword')}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <FormError message={error} />
          <div>
            <Button type="submit" variant="primary" loading={busy} disabled={password === ''}>
              {t('settings.security.makeNew')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
