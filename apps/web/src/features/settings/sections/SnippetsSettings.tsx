import type { Snippet } from '@neotext/shared';
import { type FormEvent, useState } from 'react';
import { useT } from '../../../lib/i18n';
import { updateSettings, useSettings } from '../../../state/settings';
import { Button, Dialog, EmptyState, TextArea, TextField } from '../../../ui';
import { newIdempotencyKey } from '../../chat/streaming/stream-client';
import { Group, SectionHeader } from '../SettingsParts';
import styles from './SnippetsSettings.module.css';

// The settings schema's bounds: a snippet past one is dropped from the list when it is saved.
const TRIGGER = /^[a-z0-9-]{1,32}$/;
const MAX_TITLE = 200;
const MAX_BODY = 20_000;

interface Draft {
  trigger: string;
  title: string;
  body: string;
}
type Problems = Partial<Record<keyof Draft, string>>;

function SnippetForm({
  snippet,
  all,
  onClose,
}: {
  snippet: Snippet | null;
  all: Snippet[];
  onClose: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<Draft>({
    trigger: snippet?.trigger ?? '',
    title: snippet?.title ?? '',
    body: snippet?.body ?? '',
  });
  const [problems, setProblems] = useState<Problems>({});
  const set = (key: keyof Draft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));

  function save(e: FormEvent) {
    e.preventDefault();
    // People type the slash they will use to find it; it is not part of the trigger.
    const trigger = draft.trigger.trim().replace(/^\//, '');
    const title = draft.title.trim();
    const found: Problems = {};
    if (!TRIGGER.test(trigger)) found.trigger = t('settings.snippets.triggerInvalid');
    else if (all.some((s) => s.trigger === trigger && s.id !== snippet?.id)) {
      found.trigger = t('settings.snippets.triggerTaken');
    }
    if (title === '') found.title = t('settings.snippets.titleRequired');
    else if (title.length > MAX_TITLE) found.title = t('settings.snippets.titleTooLong');
    if (draft.body.trim() === '') found.body = t('settings.snippets.bodyRequired');
    else if (draft.body.length > MAX_BODY) found.body = t('settings.snippets.bodyTooLong');
    setProblems(found);
    if (Object.keys(found).length > 0) return;

    const next: Snippet = snippet
      ? { ...snippet, trigger, title, body: draft.body }
      : { id: newIdempotencyKey(), trigger, title, body: draft.body };
    // A list is replaced whole by a settings change.
    updateSettings({
      snippets: snippet ? all.map((s) => (s.id === snippet.id ? next : s)) : [...all, next],
    });
    onClose();
  }

  return (
    <form className={styles.form} onSubmit={save} noValidate>
      <TextField
        label={t('settings.snippets.trigger')}
        hint={t('settings.snippets.triggerHint')}
        value={draft.trigger}
        onChange={(e) => set('trigger')(e.target.value)}
        error={problems.trigger}
        autoComplete="off"
        spellCheck={false}
        dir="ltr"
      />
      <TextField
        label={t('settings.snippets.title')}
        value={draft.title}
        onChange={(e) => set('title')(e.target.value)}
        error={problems.title}
        maxLength={MAX_TITLE}
        autoComplete="off"
      />
      <TextArea
        label={t('settings.snippets.body')}
        value={draft.body}
        onChange={(e) => set('body')(e.target.value)}
        error={problems.body}
        minRows={4}
        maxRows={12}
        dir="auto"
      />
      <div className={styles.actions}>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary">
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

export function SnippetsSettings() {
  const t = useT();
  const snippets = useSettings((s) => s.settings.snippets);
  /** `null` while closed, `'new'` for a blank form, else the snippet being edited. */
  const [editing, setEditing] = useState<Snippet | 'new' | null>(null);
  const close = () => setEditing(null);

  return (
    <>
      <SectionHeader
        title={t('settings.sections.snippets')}
        intro={t('settings.snippets.intro', { example: '{{name}}' })}
      />
      <Group title={t('settings.snippets.listTitle')}>
        {snippets.length === 0 ? (
          <EmptyState title={t('settings.snippets.empty')} />
        ) : (
          <ul className={styles.list} aria-label={t('settings.snippets.list')}>
            {snippets.map((s) => (
              <li key={s.id} className={styles.row}>
                <span className={styles.trigger}>/{s.trigger}</span>
                <span className={styles.title}>{s.title}</span>
                <span className={styles.buttons}>
                  <Button size="sm" onClick={() => setEditing(s)}>
                    {t('settings.snippets.edit')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      updateSettings({ snippets: snippets.filter((x) => x.id !== s.id) })
                    }
                  >
                    {t('common.delete')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div>
          <Button onClick={() => setEditing('new')}>{t('settings.snippets.add')}</Button>
        </div>
      </Group>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={
          editing === 'new' ? t('settings.snippets.addTitle') : t('settings.snippets.editTitle')
        }
      >
        {editing !== null ? (
          <SnippetForm
            snippet={editing === 'new' ? null : editing}
            all={snippets}
            onClose={close}
          />
        ) : null}
      </Dialog>
    </>
  );
}
