import {
  EXPORT_PASSPHRASE_MIN,
  type ExportBody,
  ExportErrorReasonSchema,
  type ExportFormat,
} from '@neotext/shared';
import { type FormEvent, useId, useState } from 'react';
import { ApiError } from '../../../lib/api/client';
import { downloadExport } from '../../../lib/api/transfer';
import { useT } from '../../../lib/i18n';
import { Button, Switch, TextField, toast } from '../../../ui';
import styles from './ExportPanel.module.css';

const FORMATS: ExportFormat[] = ['neotext', 'markdown', 'json'];

/** The reason a server error carries in `details`, when it is one the panel can word. */
function errorReason(err: ApiError) {
  const parsed = ExportErrorReasonSchema.safeParse(
    (err.details as { reason?: unknown } | undefined)?.reason,
  );
  return parsed.success ? parsed.data : null;
}

/** Downloads all of the user's data as an encrypted NeoText file, Markdown or plain JSON. */
export function ExportPanel() {
  const t = useT();
  const name = useId();
  const [format, setFormat] = useState<ExportFormat>('neotext');
  const [passphrase, setPassphrase] = useState('');
  const [repeat, setRepeat] = useState('');
  const [withKeys, setWithKeys] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<{ passphrase?: string; repeat?: string }>({});
  const [busy, setBusy] = useState(false);
  /** Attached files the last download left out; shown until the next export starts. */
  const [skipped, setSkipped] = useState(0);

  function bodyOrErrors(): ExportBody | null {
    if (format === 'markdown') return { format };
    if (format === 'json') return confirmed ? { format, confirmPlaintext: true } : null;
    const next: typeof errors = {};
    if (passphrase.length < EXPORT_PASSPHRASE_MIN) {
      next.passphrase = t('settings.data.export.passphraseShort', { min: EXPORT_PASSPHRASE_MIN });
    } else if (repeat !== passphrase) {
      next.repeat = t('settings.data.export.passphraseMismatch');
    }
    setErrors(next);
    if (next.passphrase || next.repeat) return null;
    return { format, passphrase, includeProviderKeys: withKeys };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = bodyOrErrors();
    if (!body) return;
    setBusy(true);
    setSkipped(0);
    try {
      const { skippedAttachments } = await downloadExport(body);
      setSkipped(skippedAttachments);
      setPassphrase('');
      setRepeat('');
      toast({ message: t('settings.data.export.done'), tone: 'success' });
    } catch (err) {
      const reason = err instanceof ApiError ? errorReason(err) : null;
      toast({
        message: reason
          ? t(`settings.data.export.errors.${reason}`)
          : err instanceof ApiError
            ? err.message
            : t('common.genericError'),
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.panel} onSubmit={(e) => void submit(e)} noValidate>
      <fieldset className={styles.formats}>
        <legend className={styles.legend}>{t('settings.data.export.format')}</legend>
        {FORMATS.map((f) => (
          <div key={f} className={styles.format}>
            <label className={styles.choice}>
              <input
                type="radio"
                name={name}
                value={f}
                checked={format === f}
                onChange={() => {
                  setFormat(f);
                  setErrors({});
                }}
                aria-describedby={`${name}-${f}`}
              />
              <span className={styles.choiceLabel}>{t(`settings.data.export.formats.${f}`)}</span>
            </label>
            <p id={`${name}-${f}`} className={styles.explain}>
              {t(`settings.data.export.explain.${f}`)}
            </p>
          </div>
        ))}
      </fieldset>

      {format === 'neotext' ? (
        <div className={styles.fields}>
          <TextField
            label={t('settings.data.export.passphrase')}
            type="password"
            autoComplete="new-password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            hint={t('settings.data.export.passphraseHint')}
            error={errors.passphrase}
          />
          <TextField
            label={t('settings.data.export.repeat')}
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            error={errors.repeat}
          />
          <Switch
            label={t('settings.data.export.includeKeys')}
            hint={t('settings.data.export.includeKeysHint')}
            checked={withKeys}
            onChange={setWithKeys}
          />
        </div>
      ) : null}

      {format === 'json' ? (
        <label className={styles.warning}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>{t('settings.data.export.plainWarning')}</span>
        </label>
      ) : null}

      <div>
        <Button
          type="submit"
          variant="primary"
          loading={busy}
          disabled={format === 'json' && !confirmed}
        >
          {t('settings.data.export.action')}
        </Button>
      </div>

      {skipped > 0 ? (
        <p className={styles.explain} role="status">
          {t('settings.data.export.skippedAttachments', { count: skipped })}
        </p>
      ) : null}
    </form>
  );
}
