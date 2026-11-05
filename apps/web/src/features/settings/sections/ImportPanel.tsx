import {
  ImportErrorReasonSchema,
  type ImportFailure,
  type ImportResult,
  type ImportSource,
} from '@neotext/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { ApiError } from '../../../lib/api/client';
import { transferApi } from '../../../lib/api/transfer';
import { useT } from '../../../lib/i18n';
import { qk } from '../../../lib/query';
import { flushSettings, refetchSettings } from '../../../state/settings';
import { Button, Switch, TextField, toast } from '../../../ui';
import styles from './ImportPanel.module.css';

const SOURCES: ImportSource[] = ['neotext', 'chatgpt', 'claude'];

const PRODUCT: Record<ImportSource, string> = {
  neotext: 'NeoText',
  chatgpt: 'ChatGPT',
  claude: 'Claude',
};

/** The reason a server error carries in `details`, when it is one the panel can word. */
function errorReason(err: ApiError) {
  const reason = (err.details as { reason?: unknown } | undefined)?.reason;
  const parsed = ImportErrorReasonSchema.safeParse(reason);
  return parsed.success ? parsed.data : null;
}

/** Brings in a NeoText file, or the chats from a ChatGPT or Claude data export. */
export function ImportPanel() {
  const t = useT();
  const name = useId();
  const fileId = useId();
  const queryClient = useQueryClient();
  const [source, setSource] = useState<ImportSource>('neotext');
  const [file, setFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [restoreSettings, setRestoreSettings] = useState(false);
  const [passphraseError, setPassphraseError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  function errorMessage(err: unknown): string {
    if (!(err instanceof ApiError)) return t('common.genericError');
    const reason = errorReason(err) ?? (err.status === 413 ? 'too_large' : null);
    return reason
      ? t(`settings.data.import.errors.${reason}`, { product: PRODUCT[source] })
      : err.message;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    const neotext = source === 'neotext';
    if (neotext && passphrase === '') {
      setPassphraseError(t('settings.data.import.passphraseMissing'));
      return;
    }
    setPassphraseError(undefined);
    setBusy(true);
    setResult(null);
    try {
      const withSettings = neotext && restoreSettings;
      // Edits still on their way go out first, so the restore snapshot holds them.
      if (withSettings) await flushSettings();
      const res = await transferApi.import({
        source,
        file,
        ...(neotext ? { passphrase } : {}),
        ...(withSettings ? { restoreSettings: true } : {}),
      });
      setResult(res);
      setPassphrase('');
      for (const key of [['conversations'], qk.folders, qk.presets, qk.providers]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      if (withSettings) {
        void refetchSettings();
        void queryClient.invalidateQueries({ queryKey: qk.settingsHistory });
      }
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.panel} onSubmit={(e) => void submit(e)} noValidate>
      <fieldset className={styles.sources}>
        <legend className={styles.legend}>{t('settings.data.import.source')}</legend>
        {SOURCES.map((s) => (
          <div key={s} className={styles.source}>
            <label className={styles.choice}>
              <input
                type="radio"
                name={name}
                value={s}
                checked={source === s}
                onChange={() => {
                  setSource(s);
                  setPassphraseError(undefined);
                  setResult(null);
                }}
                aria-describedby={`${name}-${s}`}
              />
              <span className={styles.choiceLabel}>{t(`settings.data.import.sources.${s}`)}</span>
            </label>
            <p id={`${name}-${s}`} className={styles.explain}>
              {t(`settings.data.import.how.${s}`)}
            </p>
          </div>
        ))}
      </fieldset>

      <div className={styles.fileField}>
        <label className={styles.fileLabel} htmlFor={fileId}>
          {t('settings.data.import.file')}
        </label>
        <input
          id={fileId}
          className={styles.file}
          type="file"
          accept={source === 'neotext' ? '.ntxb' : '.json,.zip'}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResult(null);
          }}
        />
      </div>

      {source === 'neotext' ? (
        <div className={styles.fields}>
          <TextField
            label={t('settings.data.import.passphrase')}
            type="password"
            autoComplete="off"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            error={passphraseError}
          />
          <Switch
            label={t('settings.data.import.restoreSettings')}
            hint={t('settings.data.import.restoreSettingsHint')}
            checked={restoreSettings}
            onChange={setRestoreSettings}
          />
        </div>
      ) : null}

      <div>
        <Button type="submit" variant="primary" loading={busy} disabled={!file}>
          {t('settings.data.import.action')}
        </Button>
      </div>

      {result ? <Summary result={result} /> : null}
    </form>
  );
}

function Summary({ result }: { result: ImportResult }) {
  const t = useT();
  // Provider refusals are worded by the server's endpoint checks; those keep its text.
  const failureReason = (f: ImportFailure) =>
    f.code && f.code !== 'provider_rejected'
      ? t(`settings.data.import.failures.${f.code}`)
      : f.reason;
  const listId = useId();
  return (
    <div className={styles.summary} role="status">
      <p className={styles.counts}>
        <span>{t('settings.data.import.imported', { count: result.imported })}</span>
        {result.skipped > 0 ? (
          <span>{t('settings.data.import.skipped', { count: result.skipped })}</span>
        ) : null}
      </p>
      {result.attachmentNotes ? (
        <p>{t('settings.data.import.attachmentNotes', { count: result.attachmentNotes })}</p>
      ) : null}
      {result.failed.length > 0 ? (
        <>
          <p id={listId} className={styles.failedTitle}>
            {t('settings.data.import.failed', { count: result.failed.length })}
          </p>
          <ul className={styles.failures} aria-labelledby={listId}>
            {result.failed.map((f, i) => (
              // Failures have no id of their own and never reorder.
              // biome-ignore lint/suspicious/noArrayIndexKey: a static list
              <li key={i} className={styles.failure}>
                <span className={styles.failureTitle}>
                  {f.title ?? t('settings.data.import.untitled')}
                </span>
                <span className={styles.reason}>{failureReason(f)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
