import { type FormEvent, type SyntheticEvent, useState } from 'react';
import { useT } from '../../../lib/i18n';
import { Button, Dialog, TextField } from '../../../ui';
import styles from './SnippetMenu.module.css';

export interface SnippetVariablesDialogProps {
  title: string;
  names: string[];
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}

/** Asks for the value of each `{{variable}}` in a snippet before it is inserted. */
/**
 * The dialog is portaled, but React events still bubble to its React parent: the composer's form.
 * Stopping them here keeps Insert from sending the message and Escape from stopping an answer.
 */
const contain = (e: SyntheticEvent) => e.stopPropagation();

export function SnippetVariablesDialog({
  title,
  names,
  onSubmit,
  onCancel,
}: SnippetVariablesDialogProps) {
  const t = useT();
  const [values, setValues] = useState<Record<string, string>>({});

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit(values);
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only contains events, never handles them
    <div style={{ display: 'contents' }} onKeyDown={contain} onSubmit={contain}>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onCancel();
        }}
        title={title}
        description={t('chat.snippets.variablesIntro')}
        size="sm"
      >
        <form className={styles.form} onSubmit={submit}>
          {names.map((name) => (
            <TextField
              key={name}
              label={name}
              value={values[name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
            />
          ))}
          <div className={styles.actions}>
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary">
              {t('chat.snippets.insert')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
