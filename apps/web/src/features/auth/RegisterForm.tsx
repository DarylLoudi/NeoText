import type { PublicUser, RegistrationPolicy } from '@neotext/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useRef, useState } from 'react';
import { beginSession } from '../../app/session-flow';
import { authApi } from '../../lib/api/auth';
import { ApiError } from '../../lib/api/client';
import { useT } from '../../lib/i18n';
import { useInstance } from '../../state/session';
import { Button, TextField } from '../../ui';
import { mapError } from './authErrors';
import { FormError } from './FormError';
import { RecoveryKeyPanel } from './RecoveryKeyPanel';
import styles from './RegisterForm.module.css';
import { StepHeading } from './StepHeading';
import { useFocusFirstError } from './useFocusFirstError';

const FIELDS = ['username', 'displayName', 'password', 'inviteCode'] as const;
type Field = (typeof FIELDS)[number] | 'repeat';

const REASONS = ['closed', 'invite_invalid', 'username_taken'] as const;
type Reason = (typeof REASONS)[number];

/** The reason a refusal from the server carries, when it is one the form can word. */
function refusalReason(err: unknown): Reason | null {
  if (!(err instanceof ApiError)) return null;
  const reason = (err.details as { reason?: unknown } | undefined)?.reason;
  return REASONS.find((r) => r === reason) ?? null;
}

export interface RegisterFormProps {
  /** `invite` asks for a code; `open` does not. */
  registration: Exclude<RegistrationPolicy, 'closed'>;
  /** The recovery key was acknowledged. */
  onDone: (user: PublicUser) => void;
}

export function RegisterForm({ registration, onDone }: RegisterFormProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const escrow = useInstance().data?.escrow === true;
  const [failures, setFailures] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, failures);
  const [values, setValues] = useState({
    username: '',
    displayName: '',
    password: '',
    repeat: '',
    inviteCode: '',
  });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [form, setForm] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ user: PublicUser; recoveryKey: string } | null>(null);

  const bind = (name: Field) => ({
    value: values[name],
    error: errors[name],
    onChange: (e: { target: { value: string } }) =>
      setValues((v) => ({ ...v, [name]: e.target.value })),
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setForm(undefined);
    if (values.password !== values.repeat) {
      setErrors({ repeat: t('auth.passwordMismatch') });
      setFailures((n) => n + 1);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const displayName = values.displayName.trim();
      const res = await authApi.register({
        username: values.username.trim(),
        password: values.password,
        ...(displayName ? { displayName } : {}),
        ...(registration === 'invite' ? { inviteCode: values.inviteCode.trim() } : {}),
      });
      beginSession(res.user, queryClient);
      setCreated(res);
    } catch (err) {
      const reason = refusalReason(err);
      if (reason === 'invite_invalid') {
        setErrors({ inviteCode: t('auth.register.errors.invite_invalid') });
      } else if (reason === 'username_taken') {
        setErrors({ username: t('auth.register.errors.username_taken') });
      } else if (reason) {
        setForm(t(`auth.register.errors.${reason}`));
      } else {
        const mapped = mapError(err, FIELDS);
        setErrors(mapped.fields);
        setForm(mapped.form);
      }
      setFailures((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <RecoveryKeyPanel
        recoveryKey={created.recoveryKey}
        title={t('auth.recoveryKeyTitle')}
        body={t('auth.recoveryKeyBody')}
        onContinue={() => onDone(created.user)}
      />
    );
  }

  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      <StepHeading>{t('auth.register.title')}</StepHeading>
      {registration === 'invite' ? (
        <p className={styles.intro}>{t('auth.register.intro')}</p>
      ) : null}
      <div className={styles.fields}>
        {registration === 'invite' ? (
          <TextField
            label={t('auth.register.inviteCode')}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            {...bind('inviteCode')}
          />
        ) : null}
        <TextField
          label={t('auth.username')}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          {...bind('username')}
        />
        <TextField
          label={t('auth.displayName')}
          hint={t('auth.displayNameHint')}
          autoComplete="name"
          {...bind('displayName')}
        />
        <TextField
          label={t('auth.password')}
          type="password"
          autoComplete="new-password"
          required
          {...bind('password')}
        />
        <TextField
          label={t('auth.repeatPassword')}
          type="password"
          autoComplete="new-password"
          required
          {...bind('repeat')}
        />
      </div>
      {escrow ? <p className={styles.intro}>{t('auth.escrowNote')}</p> : null}
      <FormError message={form} />
      <div className={styles.actions}>
        <Button type="submit" variant="primary" loading={busy}>
          {t('auth.setup.create')}
        </Button>
        <Link to="/login" className={styles.link}>
          {t('auth.backToSignIn')}
        </Link>
      </div>
    </form>
  );
}
