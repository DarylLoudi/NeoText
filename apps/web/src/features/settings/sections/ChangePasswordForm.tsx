import { type FormEvent, useRef, useState } from 'react';
import { authApi } from '../../../lib/api/auth';
import { ApiError } from '../../../lib/api/client';
import { useT } from '../../../lib/i18n';
import { Button, TextField, toast } from '../../../ui';
import { mapError } from '../../auth/authErrors';
import { FormError } from '../../auth/FormError';
import { useFocusFirstError } from '../../auth/useFocusFirstError';
import styles from './ChangePasswordForm.module.css';

type Field = 'currentPassword' | 'newPassword' | 'repeat';
const EMPTY = { currentPassword: '', newPassword: '', repeat: '' };

export function ChangePasswordForm() {
  const t = useT();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [failures, setFailures] = useState(0);
  const [busy, setBusy] = useState(false);
  useFocusFirstError(formRef, failures);

  const bind = (name: Field) => ({
    value: values[name],
    onChange: (e: { target: { value: string } }) =>
      setValues((v) => ({ ...v, [name]: e.target.value })),
    ...(errors[name] ? { error: errors[name] } : {}),
  });

  function fail(next: Partial<Record<Field, string>>, form?: string) {
    setErrors(next);
    setFormError(form);
    setFailures((n) => n + 1);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (values.newPassword !== values.repeat) {
      return fail({ repeat: t('auth.passwordMismatch') });
    }
    setErrors({});
    setFormError(undefined);
    setBusy(true);
    try {
      await authApi.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      setValues(EMPTY);
      toast({ message: t('settings.security.passwordChanged'), tone: 'success' });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_credentials') {
        fail({ currentPassword: t('auth.wrongPassword') });
      } else {
        const mapped = mapError(err, ['currentPassword', 'newPassword'] as const);
        fail(mapped.fields, mapped.form);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      <TextField
        label={t('settings.security.currentPassword')}
        type="password"
        autoComplete="current-password"
        {...bind('currentPassword')}
      />
      <TextField
        label={t('settings.security.newPassword')}
        type="password"
        autoComplete="new-password"
        hint={t('auth.passwordHint', { count: 10 })}
        {...bind('newPassword')}
      />
      <TextField
        label={t('settings.security.repeatPassword')}
        type="password"
        autoComplete="new-password"
        {...bind('repeat')}
      />
      <p className={styles.note}>{t('settings.security.passwordHint')}</p>
      <FormError message={formError} />
      <div>
        <Button type="submit" variant="primary" loading={busy}>
          {t('settings.security.changePassword')}
        </Button>
      </div>
    </form>
  );
}
