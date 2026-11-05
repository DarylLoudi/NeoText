import type { SearchResult } from '@neotext/shared';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Dialog as D } from 'radix-ui';
import { Fragment, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { searchApi } from '../../lib/api/search';
import { useT } from '../../lib/i18n';
import { Button, Kbd } from '../../ui';
import { splitHighlight } from './highlight';
import styles from './SearchDialog.module.css';

export interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const SEARCH_DEBOUNCE_MS = 200;
const MIN_LENGTH = 2;

/** Highlighted text: matches become `<mark>` nodes; the text itself is never parsed as HTML. */
function Highlighted({ text, query }: { text: string; query: string }) {
  return splitHighlight(text, query).map((part, i) => {
    const key = `${i}:${part.text.length}`;
    return part.match ? (
      <mark key={key}>{part.text}</mark>
    ) : (
      <Fragment key={key}>{part.text}</Fragment>
    );
  });
}

export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const t = useT();
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={styles.overlay} />
        <D.Content className={styles.content}>
          <D.Title className={styles.hidden}>{t('shell.search.title')}</D.Title>
          <D.Description className={styles.hidden}>{t('shell.search.description')}</D.Description>
          <SearchBody close={() => onOpenChange(false)} />
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Mounted only while the dialog is open, so each opening starts empty. */
function SearchBody({ close }: { close: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [term, setTerm] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const trimmed = value.trim();

  useEffect(() => {
    if (trimmed.length < MIN_LENGTH) {
      setTerm('');
      return;
    }
    const handle = setTimeout(() => setTerm(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [trimmed]);

  const query = useInfiniteQuery({
    queryKey: ['search', term],
    queryFn: ({ pageParam, signal }) => searchApi.search(term, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: term !== '',
    staleTime: 0,
    gcTime: 0,
  });
  const current = term !== '' && term === trimmed;
  const results: SearchResult[] = current
    ? (query.data?.pages.flatMap((p) => p.results) ?? [])
    : [];
  const hasMore = current && query.hasNextPage;
  const waiting = trimmed.length >= MIN_LENGTH && (!current || query.isFetching);

  const openResult = (r: SearchResult) => {
    close();
    void navigate({
      to: '/c/$conversationId',
      params: { conversationId: r.conversationId },
      search: r.messageId ? { m: r.messageId } : {},
    });
  };

  const buttons = () => [...(listRef.current?.querySelectorAll<HTMLElement>('button') ?? [])];
  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowDown') return;
    buttons()[0]?.focus();
    e.preventDefault();
  };
  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const all = buttons();
    const at = all.indexOf(document.activeElement as HTMLElement);
    all[Math.max(0, Math.min(all.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
    e.preventDefault();
  };

  let note = '';
  if (query.isError && current) note = t('shell.search.failed');
  else if (trimmed.length < MIN_LENGTH) note = t('shell.search.hint');
  else if (waiting) note = t('shell.search.searching');
  else if (results.length === 0 && !hasMore) note = t('shell.search.empty', { query: term });

  return (
    <>
      <div className={styles.inputRow}>
        <MagnifyingGlass className={styles.icon} aria-hidden />
        <input
          className={styles.input}
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onInputKey}
          placeholder={t('shell.search.placeholder')}
          aria-label={t('shell.search.inputLabel')}
          autoComplete="off"
          // biome-ignore lint/a11y/noAutofocus: the dialog exists to be typed into
          autoFocus
        />
        <Kbd>Esc</Kbd>
      </div>
      <ul
        className={styles.list}
        ref={listRef}
        aria-label={t('shell.search.listLabel')}
        onKeyDown={onListKey}
      >
        {results.map((r) => (
          <li key={`${r.conversationId}:${r.messageId ?? 'title'}`}>
            <button type="button" className={styles.result} onClick={() => openResult(r)}>
              <span className={styles.resultTitle} dir="auto">
                {r.title ? <Highlighted text={r.title} query={term} /> : t('shell.search.untitled')}
              </span>
              {r.matchedIn === 'message' ? (
                <span className={styles.snippet} dir="auto">
                  <Highlighted text={r.snippet} query={term} />
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      <p className={styles.note} aria-live="polite">
        {note}
      </p>
      {hasMore && !waiting ? (
        <div className={styles.more}>
          <Button size="sm" onClick={() => void query.fetchNextPage()}>
            {t('shell.search.further')}
          </Button>
        </div>
      ) : null}
    </>
  );
}
