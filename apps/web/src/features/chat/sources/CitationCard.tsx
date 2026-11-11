import type { Source } from '@neotext/shared';
import * as P from 'radix-ui/popover';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import styles from './CitationCard.module.css';
import { sourceForCitation } from './citations';
import { Favicon } from './Favicon';
import { SourceNumber } from './SourceCard';

/** How the reader reached a citation chip. Hover waits a moment; focus shows the card at once. */
export type CitationVia = 'hover' | 'focus';
export type CitationHandler = (cite: HTMLElement | null, via: CitationVia) => void;

const OPEN_DELAY_MS = 150;
/** Room to move the pointer from a chip onto its card without the card closing. */
const CLOSE_DELAY_MS = 120;

export interface CitationCardState {
  anchor: HTMLElement | null;
  /** Pass to `Markdown`'s `onCitation`; stable for the life of the component. */
  onCitation: CitationHandler;
  /** Keeps the card open while the pointer is on it. */
  hold: (held: boolean) => void;
  close: () => void;
}

export function useCitationCard(): CitationCardState {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focused = useRef<HTMLElement | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const later = useCallback(
    (ms: number, fn: () => void) => {
      clear();
      timer.current = setTimeout(() => {
        timer.current = null;
        fn();
      }, ms);
    },
    [clear],
  );

  const onCitation = useCallback<CitationHandler>(
    (cite, via) => {
      if (via === 'focus') {
        focused.current = cite;
        clear();
        setAnchor(cite);
        return;
      }
      if (cite) later(OPEN_DELAY_MS, () => setAnchor(cite));
      // Leaving with the pointer keeps a card the keyboard opened.
      else later(CLOSE_DELAY_MS, () => setAnchor(focused.current));
    },
    [clear, later],
  );

  const hold = useCallback(
    (held: boolean) => {
      if (held) clear();
      else later(CLOSE_DELAY_MS, () => setAnchor(focused.current));
    },
    [clear, later],
  );

  const close = useCallback(() => {
    clear();
    // A dismissed card stays closed: leaving another chip must not bring this one back.
    focused.current = null;
    setAnchor(null);
  }, [clear]);

  useEffect(() => clear, [clear]);

  return useMemo(() => ({ anchor, onCitation, hold, close }), [anchor, onCitation, hold, close]);
}

export interface CitationCardProps {
  sources: Source[];
  anchor: HTMLElement | null;
  onClose: () => void;
  onHold?: (held: boolean) => void;
}

/**
 * The floating card for the citation chip under the pointer or focus. It never takes focus, and
 * every value from the page is rendered as React text.
 */
export function CitationCard({ sources, anchor, onClose, onHold }: CitationCardProps) {
  const source = anchor ? sourceForCitation(anchor, sources) : undefined;
  const anchorRef = useMemo(() => ({ current: anchor }), [anchor]);
  const open = anchor !== null && source !== undefined && anchor.isConnected;
  const bodyId = useId();

  // The chip names the card as its description while it is open, for screen readers.
  useEffect(() => {
    if (!open || !anchor) return;
    anchor.setAttribute('aria-describedby', bodyId);
    return () => anchor.removeAttribute('aria-describedby');
  }, [open, anchor, bodyId]);

  return (
    <P.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <P.Anchor virtualRef={anchorRef} />
      <P.Portal>
        {source ? (
          <P.Content
            className={styles.card}
            side="top"
            align="start"
            sideOffset={6}
            collisionPadding={8}
            aria-label={source.title || source.domain}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onPointerEnter={() => onHold?.(true)}
            onPointerLeave={() => onHold?.(false)}
          >
            <div id={bodyId} className={styles.body}>
              <p className={styles.site}>
                <SourceNumber n={source.n} />
                <Favicon url={source.url} domain={source.domain} />
                <span className={styles.domain}>{source.domain}</span>
              </p>
              {source.title ? (
                <p className={styles.title} dir="auto">
                  {source.title}
                </p>
              ) : null}
              {source.snippet ? (
                <p className={styles.snippet} dir="auto">
                  {source.snippet}
                </p>
              ) : null}
            </div>
          </P.Content>
        ) : null}
      </P.Portal>
    </P.Root>
  );
}
