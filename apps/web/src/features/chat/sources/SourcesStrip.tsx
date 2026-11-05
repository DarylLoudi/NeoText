import type { Source } from '@neotext/shared';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useT } from '../../../lib/i18n';
import { Button, IconButton } from '../../../ui';
import { pageSizeForWidth, paginate } from './pagination';
import { SourceCard } from './SourceCard';
import { SourcesDrawer } from './SourcesDrawer';
import styles from './SourcesStrip.module.css';

export interface SourcesStripProps {
  sources: Source[];
}

/** Cards per page for the strip's own width, measured before paint and on every resize. */
function usePageSize(ref: React.RefObject<HTMLElement | null>): number {
  const [size, setSize] = useState(4);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A strip that is not laid out (width 0) keeps the size it had.
    const measure = (width: number) => {
      if (width > 0) setSize(pageSizeForWidth(width));
    };
    measure(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) measure(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * The sources under an answer, a page of cards at a time. The first card shown is what stays
 * put: more sources streaming in or a narrower window never jump the reader to another page.
 */
export function SourcesStrip({ sources }: SourcesStripProps) {
  const t = useT();
  const headingId = useId();
  const rootRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const pageSize = usePageSize(rootRef);
  const [first, setFirst] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** Said by the live region only after the reader pages, never as sources stream in. */
  const [announced, setAnnounced] = useState('');
  /** Set when the page changed while a card had focus, so focus moves to the new page. */
  const refocus = useRef(false);

  const range = paginate(sources.length, pageSize, Math.floor(first / pageSize));
  const shown = sources.slice(range.start, range.end);

  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    listRef.current?.querySelector<HTMLElement>('a')?.focus();
  });

  const goTo = (page: number) => {
    const next = paginate(sources.length, pageSize, page);
    if (next.page === range.page) return;
    refocus.current = listRef.current?.contains(document.activeElement) ?? false;
    setFirst(next.start);
    setAnnounced(t('chat.sourceStrip.announce', { range: rangeLabel(next.start, next.end) }));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    // React bubbles keys from the drawer's portal here too; its search field keeps its arrows.
    if (!(e.target instanceof Node) || !rootRef.current?.contains(e.target)) return;
    e.preventDefault();
    goTo(range.page + (e.key === 'ArrowRight' ? 1 : -1));
  };

  function rangeLabel(start: number, end: number): string {
    return end - start === 1
      ? t('chat.sourceStrip.rangeOne', { at: start + 1, total: sources.length })
      : t('chat.sourceStrip.range', { start: start + 1, end, total: sources.length });
  }
  const label = rangeLabel(range.start, range.end);

  return (
    <section
      ref={rootRef}
      className={styles.strip}
      aria-labelledby={headingId}
      onKeyDown={onKeyDown}
    >
      <div className={styles.header}>
        <h3 id={headingId} className={styles.heading}>
          {t('chat.sourceStrip.title')}
        </h3>
        <span className={styles.range}>{label}</span>
        <span className={styles.visuallyHidden} aria-live="polite">
          {announced}
        </span>
        <span className={styles.actions}>
          {range.pageCount > 1 ? (
            <>
              <IconButton
                size="sm"
                label={t('chat.sourceStrip.previous')}
                icon={<CaretLeft aria-hidden />}
                disabled={!range.hasPrev}
                onClick={() => goTo(range.page - 1)}
              />
              <IconButton
                size="sm"
                label={t('chat.sourceStrip.next')}
                icon={<CaretRight aria-hidden />}
                disabled={!range.hasNext}
                onClick={() => goTo(range.page + 1)}
              />
            </>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setDrawerOpen(true)}>
            {t('chat.sourceStrip.all')}
          </Button>
        </span>
      </div>
      <ul
        ref={listRef}
        className={styles.cards}
        style={{ '--per-page': pageSize } as CSSProperties}
        aria-label={t('chat.sourceStrip.page')}
      >
        {shown.map((s) => (
          <li key={s.n} className={styles.cell}>
            <SourceCard source={s} />
          </li>
        ))}
      </ul>
      <SourcesDrawer sources={sources} open={drawerOpen} onOpenChange={setDrawerOpen} />
    </section>
  );
}
