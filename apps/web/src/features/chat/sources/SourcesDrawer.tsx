import type { Source } from '@neotext/shared';
import { useMemo, useRef, useState } from 'react';
import { useT } from '../../../lib/i18n';
import { Dialog, TextField } from '../../../ui';
import { Favicon } from './Favicon';
import { SOURCE_LINK_REL, SourceNumber } from './SourceCard';
import styles from './SourcesDrawer.module.css';

export interface SourcesDrawerProps {
  sources: Source[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function matches(source: Source, query: string): boolean {
  if (query === '') return true;
  return [source.title, source.domain, source.snippet].some((field) =>
    field.toLocaleLowerCase().includes(query),
  );
}

/** Every source of an answer with its snippet, searchable. Page text is shown as plain text. */
export function SourcesDrawer({ sources, open, onOpenChange }: SourcesDrawerProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const needle = query.trim().toLocaleLowerCase();
  const shown = useMemo(() => sources.filter((s) => matches(s, needle)), [sources, needle]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery('');
        onOpenChange(next);
      }}
      title={t('chat.sourceStrip.all')}
      size="lg"
      initialFocus={searchRef}
    >
      <TextField
        ref={searchRef}
        type="search"
        label={t('chat.sourceStrip.search')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
      />
      {shown.length === 0 ? (
        <p className={styles.empty}>{t('chat.sourceStrip.noMatch', { query: query.trim() })}</p>
      ) : (
        <ol className={styles.list}>
          {shown.map((s) => (
            <li key={s.n} className={styles.item}>
              <SourceNumber n={s.n} />
              <div className={styles.body}>
                <p className={styles.site}>
                  <Favicon url={s.url} domain={s.domain} />
                  <span className={styles.domain}>{s.domain}</span>
                </p>
                <a className={styles.title} href={s.url} target="_blank" rel={SOURCE_LINK_REL}>
                  <span dir="auto">{s.title || s.domain}</span>
                </a>
                {s.snippet ? (
                  <p className={styles.snippet} dir="auto">
                    {s.snippet}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  );
}
