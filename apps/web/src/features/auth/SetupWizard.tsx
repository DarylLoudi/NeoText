import type { InstanceMode, PublicUser } from '@neotext/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { beginSession } from '../../app/session-flow';
import { authApi } from '../../lib/api/auth';
import { providersApi } from '../../lib/api/providers';
import { useT } from '../../lib/i18n';
import { qk } from '../../lib/query';
import { Button, Switch, TextField } from '../../ui';
import { mapError } from './authErrors';
import { FormError } from './FormError';
import { RecoveryKeyPanel } from './RecoveryKeyPanel';
import styles from './SetupWizard.module.css';
import { StepHeading } from './StepHeading';
import { useFocusFirstError } from './useFocusFirstError';

const FIELDS = ['username', 'displayName', 'password'] as const;
type Field = (typeof FIELDS)[number] | 'repeat';
type Step = 'mode' | 'account' | 'key' | 'provider';

export interface SetupWizardProps {
  envProviderAvailable: boolean;
  /** The recovery key was acknowledged and the optional steps are finished. */
  onDone: (user: PublicUser) => void;
}

export function SetupWizard({ envProviderAvailable, onDone }: SetupWizardProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const [step, setStepRaw] = useState<Step>('mode');
  const [moved, setMoved] = useState(false);
  const [failures, setFailures] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, failures);
  const setStep = (next: Step) => {
    setMoved(true);
    setStepRaw(next);
  };
  const [mode, setMode] = useState<InstanceMode>('personal');
  const [values, setValues] = useState({ username: '', displayName: '', password: '', repeat: '' });
  const [useEnv, setUseEnv] = useState(true);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [form, setForm] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ user: PublicUser; recoveryKey: string } | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [keyError, setKeyError] = useState<string | undefined>();

  const bind = (name: Field) => ({
    value: values[name],
    error: errors[name],
    onChange: (e: { target: { value: string } }) =>
      setValues((v) => ({ ...v, [name]: e.target.value })),
  });

  async function createAccount(e: FormEvent) {
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
      const res = await authApi.setup({
        username: values.username.trim(),
        password: values.password,
        ...(displayName ? { displayName } : {}),
        mode,
        ...(envProviderAvailable ? { useEnvProvider: useEnv } : {}),
      });
      beginSession(res.user, queryClient);
      queryClient.setQueryData(qk.instance, (old: unknown) =>
        old && typeof old === 'object' ? { ...old, setupRequired: false, mode } : old,
      );
      setCreated(res);
      setStep('key');
    } catch (err) {
      const mapped = mapError(err, FIELDS);
      setErrors(mapped.fields);
      setForm(mapped.form);
      setFailures((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  async function afterKey() {
    if (!created) return;
    if (envProviderAvailable && useEnv) return onDone(created.user);
    setBusy(true);
    try {
      const existing = await providersApi.list();
      if (existing.length > 0) return onDone(created.user);
      setStep('provider');
    } catch {
      onDone(created.user); // Providers can be added later in settings; do not trap the user here.
    } finally {
      setBusy(false);
    }
  }

  async function connect(e: FormEvent) {
    e.preventDefault();
    if (!created) return;
    setBusy(true);
    setKeyError(undefined);
    try {
      await providersApi.create({ kind: 'openrouter', name: 'OpenRouter', apiKey: apiKey.trim() });
      onDone(created.user);
    } catch (err) {
      setKeyError(mapError(err, []).form);
      setFailures((n) => n + 1);
      setBusy(false);
    }
  }

  if (step === 'key' && created) {
    return (
      <RecoveryKeyPanel
        recoveryKey={created.recoveryKey}
        title={t('auth.recoveryKeyTitle')}
        body={t('auth.recoveryKeyBody')}
        onContinue={afterKey}
        busy={busy}
      />
    );
  }

  if (step === 'provider') {
    return (
      <form ref={formRef} className={styles.form} onSubmit={connect} noValidate>
        <StepHeading focusOnMount>{t('auth.setup.providerTitle')}</StepHeading>
        <p className={styles.intro}>{t('auth.setup.providerBody')}</p>
        <TextField
          label={t('auth.setup.providerKey')}
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <FormError message={keyError} />
        <div className={styles.actions}>
          <Button type="submit" variant="primary" loading={busy} disabled={!apiKey.trim()}>
            {t('auth.setup.connect')}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => created && onDone(created.user)}>
            {t('auth.setup.skip')}
          </Button>
        </div>
      </form>
    );
  }

  if (step === 'mode') {
    const options: { value: InstanceMode; title: string; hint?: string }[] = [
      { value: 'personal', title: t('auth.setup.modePersonal') },
      {
        value: 'community',
        title: t('auth.setup.modeCommunity'),
        hint: t('auth.setup.modeCommunityHint'),
      },
    ];
    return (
      <div className={styles.form}>
        <StepHeading id="mode-title" focusOnMount={moved}>
          {t('auth.setup.modeTitle')}
        </StepHeading>
        <fieldset className={styles.choices} aria-labelledby="mode-title">
          {options.map((o) => (
            <label key={o.value} className={styles.choice}>
              <input
                type="radio"
                name="mode"
                value={o.value}
                checked={mode === o.value}
                onChange={() => setMode(o.value)}
                aria-labelledby={`mode-${o.value}-title`}
                aria-describedby={o.hint ? `mode-${o.value}-hint` : undefined}
              />
              <span id={`mode-${o.value}-title`} className={styles.choiceTitle}>
                {o.title}
              </span>
              {o.hint ? (
                <span id={`mode-${o.value}-hint`} className={styles.choiceHint}>
                  {o.hint}
                </span>
              ) : null}
            </label>
          ))}
        </fieldset>
        <div className={styles.actions}>
          <Button variant="primary" onClick={() => setStep('account')}>
            {t('auth.setup.next')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form ref={formRef} className={styles.form} onSubmit={createAccount} noValidate>
      <StepHeading focusOnMount>{t('auth.setup.accountTitle')}</StepHeading>
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
        {envProviderAvailable ? (
          <Switch
            label={t('auth.setup.useEnvProvider')}
            hint={t('auth.setup.useEnvProviderHint')}
            checked={useEnv}
            onChange={setUseEnv}
          />
        ) : null}
      </div>
      <FormError message={form} />
      <div className={styles.actions}>
        <Button type="submit" variant="primary" loading={busy}>
          {t('auth.setup.create')}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setStep('mode')}>
          {t('common.back')}
        </Button>
      </div>
    </form>
  );
}
