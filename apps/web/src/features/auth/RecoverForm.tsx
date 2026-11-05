import type { PublicUser } from '@neotext/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useRef, useState } from 'react';
import { beginSession } from '../../app/session-flow';
import { authApi } from '../../lib/api/auth';
import { useT } from '../../lib/i18n';
import { Button, TextField } from '../../ui';
import { mapError } from './authErrors';
import { FormError } from './FormError';
import styles from './RecoverForm.module.css';
import { RecoveryKeyPanel } from './RecoveryKeyPanel';
import { StepHeading } from './StepHeading';
import { useFocusFirstError } from './useFocusFirstError';

const FIELDS = ['username', 'recoveryKey', 'newPassword'] as const;
type Field = (typeof FIELDS)[number] | 'repeat';

export function RecoverForm({ onDone }: { onDone: (user: PublicUser) => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [failures, setFailures] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, failures);
  const [values, setValues] = useState({
    username: '',
    recoveryKey: '',
    newPassword: '',
    repeat: '',
  });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [form, setForm] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ user: PublicUser; recoveryKey: string } | null>(null);

  const bind = (name: Field) => ({
    value: values[name],
    error: errors[name],
    onChange: (e: { target: { value: string } }) =>
      setValues((v) => ({ ...v, [name]: e.target.value })),
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setForm(undefined);
    if (values.newPassword !== values.repeat) {
      setErrors({ repeat: t('auth.passwordMismatch') });
      setFailures((n) => n + 1);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const res = await authApi.recover({
        username: values.username.trim(),
        recoveryKey: values.recoveryKey.trim(),
        newPassword: values.newPassword,
      });
      beginSession(res.user, queryClient);
      setResult(res);
    } catch (err) {
      const mapped = mapError(err, FIELDS);
      setErrors(mapped.fields);
      setForm(mapped.form);
      setFailures((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <RecoveryKeyPanel
        recoveryKey={result.recoveryKey}
        title={t('auth.recover.newKeyTitle')}
        body={t('auth.recover.newKeyBody')}
        onContinue={() => onDone(result.user)}
      />
    );
  }

  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      <StepHeading>{t('auth.recover.title')}</StepHeading>
      <p className={styles.intro}>{t('auth.recover.intro')}</p>
      <div className={styles.fields}>
        <TextField
          label={t('auth.username')}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          {...bind('username')}
        />
        <TextField
          label={t('auth.recoveryKeyLabel')}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
          {...bind('recoveryKey')}
        />
        <TextField
          label={t('auth.newPassword')}
          type="password"
          autoComplete="new-password"
          required
          {...bind('newPassword')}
        />
        <TextField
          label={t('auth.repeatPassword')}
          type="password"
          autoComplete="new-password"
          required
          {...bind('repeat')}
        />
      </div>
      <FormError message={form} />
      <div className={styles.actions}>
        <Button type="submit" variant="primary" loading={busy}>
          {t('auth.recover.submit')}
        </Button>
        <Link to="/login" className={styles.link}>
          {t('auth.backToSignIn')}
        </Link>
      </div>
    </form>
  );
}
