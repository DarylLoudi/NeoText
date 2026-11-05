import type { McpServerPublic, UpdateMcpServerBody } from '@neotext/shared';
import { Plus, X } from '@phosphor-icons/react';
import { type FormEvent, useId, useRef, useState } from 'react';
import { useT } from '../../../lib/i18n';
import { Button, IconButton, TextField, toast } from '../../../ui';
import { mapError } from '../../auth/authErrors';
import { FormError } from '../../auth/FormError';
import { useFocusFirstError } from '../../auth/useFocusFirstError';
import { useMcpMutations } from '../use-mcp';
import styles from './McpServerForm.module.css';

export interface McpServerFormProps {
  /** Present when editing; absent when adding. */
  server?: McpServerPublic;
  /** After a save, and when the form is cancelled. */
  onDone: () => void;
  /** Present when editing: asks the page to confirm and delete. */
  onDelete?: () => void;
}

export const MAX_MCP_HEADERS = 10;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/;
const FIELDS = ['name', 'url'] as const;
type Field = 'name' | 'url' | 'headers';
interface Row {
  key: number;
  name: string;
  value: string;
}

function validUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Header values are write-only. A saved set shows only as "Saved"; typing new rows replaces it,
 * and leaving every row empty keeps it.
 */
export function McpServerForm({ server, onDone, onDelete }: McpServerFormProps) {
  const t = useT();
  const editing = server !== undefined;
  const { create, update } = useMcpMutations();
  const formRef = useRef<HTMLFormElement>(null);
  const noteId = useId();
  const nextKey = useRef(1);
  const [name, setName] = useState(server?.name ?? '');
  const [url, setUrl] = useState(server?.url ?? '');
  const [rows, setRows] = useState<Row[]>([]);
  const [replacing, setReplacing] = useState(false);
  const [removeHeaders, setRemoveHeaders] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [failures, setFailures] = useState(0);
  useFocusFirstError(formRef, failures);
  const busy = create.isPending || update.isPending;
  const saved = server?.hasHeaders === true;

  const addRow = () => setRows((r) => [...r, { key: nextKey.current++, name: '', value: '' }]);
  const patchRow = (key: number, patch: Partial<Row>) =>
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  function fail(next: Partial<Record<Field, string>>, form?: string) {
    setErrors(next);
    setFormError(form);
    setFailures((n) => n + 1);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: Partial<Record<Field, string>> = {};
    const cleanName = name.trim();
    const cleanUrl = url.trim();
    if (!cleanName) found.name = t('settings.mcp.nameRequired');
    if (!validUrl(cleanUrl)) found.url = t('settings.mcp.urlInvalid');
    // Blank rows are ignored; a saved set is only replaced when a row has something in it.
    const filled = rows.filter((r) => r.name.trim() || r.value);
    if (filled.some((r) => !HEADER_NAME.test(r.name.trim()))) {
      found.headers = t('settings.mcp.headerNameInvalid');
    } else if (filled.some((r) => /[\r\n\0]/.test(r.value))) {
      found.headers = t('settings.mcp.headerValueInvalid');
    } else if (filled.length > MAX_MCP_HEADERS) {
      found.headers = t('settings.mcp.headersTooMany');
    }
    if (Object.keys(found).length > 0) return fail(found);
    setErrors({});
    setFormError(undefined);
    const headers = Object.fromEntries(filled.map((r) => [r.name.trim(), r.value]));

    try {
      if (server) {
        const body: UpdateMcpServerBody = {};
        if (cleanName !== server.name) body.name = cleanName;
        if (cleanUrl !== server.url) body.url = cleanUrl;
        if (filled.length > 0) body.headers = headers;
        else if (saved && removeHeaders) body.headers = null;
        if (Object.keys(body).length > 0) await update.mutateAsync({ id: server.id, body });
        toast({ message: t('common.saved'), tone: 'success' });
      } else {
        await create.mutateAsync({
          name: cleanName,
          url: cleanUrl,
          ...(filled.length > 0 ? { headers } : {}),
        });
        toast({ message: t('settings.mcp.added'), tone: 'success' });
      }
      onDone();
    } catch (err) {
      const mapped = mapError(err, FIELDS);
      fail(mapped.fields, mapped.form);
    }
  }

  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      <TextField
        label={t('settings.mcp.name')}
        hint={t('settings.mcp.nameHint')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
        autoComplete="off"
        {...(errors.name ? { error: errors.name } : {})}
      />
      <TextField
        label={t('settings.mcp.url')}
        hint={t('settings.mcp.urlHint')}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        {...(errors.url ? { error: errors.url } : {})}
      />

      <fieldset className={styles.headers} aria-describedby={noteId}>
        <legend className={styles.legend}>{t('settings.mcp.headers')}</legend>
        {saved && !replacing ? (
          <div className={styles.savedLine}>
            <p id={noteId} className={styles.note} data-gone={removeHeaders || undefined}>
              {removeHeaders ? t('settings.mcp.headersWillGo') : t('settings.mcp.headersSaved')}
            </p>
            <div className={styles.savedActions}>
              {removeHeaders ? (
                <Button size="sm" variant="ghost" onClick={() => setRemoveHeaders(false)}>
                  {t('settings.mcp.keepHeaders')}
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setReplacing(true);
                      if (rows.length === 0) addRow();
                    }}
                  >
                    {t('settings.mcp.replaceHeaders')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRemoveHeaders(true)}>
                    {t('settings.mcp.removeHeaders')}
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            <p id={noteId} className={styles.note}>
              {saved ? t('settings.mcp.headersReplaceHint') : t('settings.mcp.headersHint')}
            </p>
            {rows.map((row, i) => (
              <div key={row.key} className={styles.headerRow}>
                <TextField
                  label={t('settings.mcp.headerName', { n: i + 1 })}
                  value={row.name}
                  onChange={(e) => patchRow(row.key, { name: e.target.value })}
                  placeholder="Authorization"
                  autoComplete="off"
                  spellCheck={false}
                />
                <TextField
                  label={t('settings.mcp.headerValue', { n: i + 1 })}
                  type="password"
                  value={row.value}
                  onChange={(e) => patchRow(row.key, { value: e.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                />
                <IconButton
                  className={styles.removeRow}
                  label={t('settings.mcp.removeHeaderRow', { n: i + 1 })}
                  icon={<X />}
                  onClick={() => setRows((r) => r.filter((x) => x.key !== row.key))}
                />
              </div>
            ))}
            {errors.headers ? (
              <p className={styles.error} role="alert">
                {errors.headers}
              </p>
            ) : null}
            <div className={styles.rowActions}>
              {rows.length < MAX_MCP_HEADERS ? (
                <Button size="sm" onClick={addRow}>
                  <Plus aria-hidden />
                  {t('settings.mcp.addHeader')}
                </Button>
              ) : null}
              {replacing ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setReplacing(false);
                    setRows([]);
                  }}
                >
                  {t('settings.mcp.keepHeaders')}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </fieldset>

      <FormError message={formError} />
      <div className={styles.actions}>
        {onDelete ? (
          <Button variant="danger" className={styles.delete} onClick={onDelete}>
            {t('settings.mcp.delete')}
          </Button>
        ) : null}
        <Button onClick={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" loading={busy}>
          {editing ? t('common.save') : t('settings.mcp.addSubmit')}
        </Button>
      </div>
    </form>
  );
}
