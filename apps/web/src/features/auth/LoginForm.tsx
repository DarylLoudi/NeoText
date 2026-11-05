import type { PublicUser } from '@neotext/shared';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useRef, useState } from 'react';
import { authApi } from '../../lib/api/auth';
import { useT } from '../../lib/i18n';
import { signUpsOpen, useInstance } from '../../state/session';
import { Button, TextField } from '../../ui';
import { mapError } from './authErrors';
import { FormError } from './FormError';
import styles from './LoginForm.module.css';
import { StepHeading } from './StepHeading';
import { useFocusFirstError } from './useFocusFirstError';

export function LoginForm({ onSuccess }: { onSuccess: (user: PublicUser) => void }) {
  const t = useT();
  const instance = useInstance();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, failures);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      onSuccess(await authApi.login({ username: username.trim(), password }));
    } catch (err) {
      setError(mapError(err, []).form);
      setBusy(false);
      setFailures((n) => n + 1);
    }
  }

  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      <StepHeading>{t('auth.signIn')}</StepHeading>
      <div className={styles.fields}>
        <TextField
          label={t('auth.username')}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
        <TextField
          label={t('auth.password')}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      <FormError message={error} />
      <div className={styles.actions}>
        <Button type="submit" variant="primary" loading={busy}>
          {t('auth.signIn')}
        </Button>
        <Link to="/recover" className={styles.link}>
          {t('auth.forgotPassword')}
        </Link>
        {signUpsOpen(instance.data?.registration ?? null) ? (
          <Link to="/register" className={styles.link}>
            {t('auth.createAccount')}
          </Link>
        ) : null}
      </div>
    </form>
  );
}
