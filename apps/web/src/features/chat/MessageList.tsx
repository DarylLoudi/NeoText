import { ArrowDown } from '@phosphor-icons/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '../../lib/i18n';
import { Button } from '../../ui';
import { CompareColumns, ShowComparison } from '../compare/CompareColumns';
import { AssistantMessage } from './AssistantMessage';
import { useChatActions } from './MessageActions';
import styles from './MessageList.module.css';
import type { CodeTheme } from './markdown/highlight';
import type { ThreadItem } from './thread';
import { UserMessage } from './UserMessage';

/** Within this distance of the bottom the list keeps following new text. */
const FOLLOW_PX = 80;
const ANNOUNCE_CLEAR_MS = 4000;
const MARK_MS = 2500;
const ROW_ESTIMATE = 180;

export interface MessageListProps {
  items: ThreadItem[];
  showCost: boolean;
  codeTheme: CodeTheme;
  /** Assistant message ids whose stream is reconnecting. */
  reconnecting: ReadonlySet<string>;
  /** Assistant message ids whose stream could not be resumed. */
  lost: ReadonlySet<string>;
  /** A message to scroll into view and mark for a moment (from a search result). */
  focusId?: string;
}

/** Announces "Response finished" when an answer on screen stops streaming. */
function useFinishedAnnouncement(items: ThreadItem[]): string {
  const t = useT();
  const [text, setText] = useState('');
  const streamingBefore = useRef(new Set<string>());
  useEffect(() => {
    const now = new Set<string>();
    let finished = false;
    for (const item of items) {
      for (const message of item.compare ?? [item.message]) {
        if (message.status === 'streaming') now.add(message.id);
        else if (streamingBefore.current.has(message.id)) finished = true;
      }
    }
    streamingBefore.current = now;
    if (!finished) return;
    setText(t('chat.responseFinished'));
    const timer = setTimeout(() => setText(''), ANNOUNCE_CLEAR_MS);
    return () => clearTimeout(timer);
  }, [items, t]);
  return text;
}

/**
 * The transcript, virtualized with measured rows. It follows the newest text while the reader
 * stays near the bottom, and offers "Jump to latest" once they scroll up.
 */
export function MessageList({
  items,
  showCost,
  codeTheme,
  reconnecting,
  lost,
  focusId,
}: MessageListProps) {
  const t = useT();
  const { conversationId } = useChatActions();
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const announcement = useFinishedAnnouncement(items);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    // A chat opens at its newest message, so the first rows rendered are the ones on screen
    // (not the oldest, rendered and thrown away a frame later).
    initialOffset: () => items.length * ROW_ESTIMATE,
    initialRect: { width: 0, height: typeof window === 'undefined' ? 0 : window.innerHeight },
    overscan: 4,
    paddingStart: 32,
    paddingEnd: 32,
    getItemKey: (index) => items[index]?.message.id ?? index,
  });
  const total = virtualizer.getTotalSize();

  // Scrolls to the searched-for message once it is on the path, and marks its edge briefly.
  const [marked, setMarked] = useState<string | null>(null);
  const focused = useRef<string | null>(null);
  const focusIndex = focusId ? items.findIndex((i) => i.message.id === focusId) : -1;
  useEffect(() => {
    if (!focusId || focusIndex < 0 || focused.current === focusId) return;
    focused.current = focusId;
    following.current = false;
    virtualizer.scrollToIndex(focusIndex, { align: 'center' });
    setMarked(focusId);
  }, [focusId, focusIndex, virtualizer]);
  // Its own timer, so a change to the effect's inputs cannot leave the marker on.
  useEffect(() => {
    if (!marked) return;
    const timer = setTimeout(() => setMarked(null), MARK_MS);
    return () => clearTimeout(timer);
  }, [marked]);

  // Rows are measured after they render, so following runs again whenever the height changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: total and items are the triggers
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [total, items]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_PX;
    following.current = near;
    setAwayFromBottom(!near);
  };

  const jump = () => {
    const el = scrollRef.current;
    if (!el) return;
    following.current = true;
    setAwayFromBottom(false);
    el.scrollTop = el.scrollHeight;
  };

  return (
    <div className={styles.wrap}>
      <section
        ref={scrollRef}
        className={styles.scroller}
        onScroll={onScroll}
        aria-label={t('chat.messages')}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must be reachable by keyboard
        tabIndex={0}
      >
        <div className={styles.canvas} style={{ height: total }}>
          {virtualizer.getVirtualItems().map((row) => {
            const item = items[row.index];
            if (!item) return null;
            return (
              <div
                key={row.key}
                ref={virtualizer.measureElement}
                data-index={row.index}
                data-marked={item.message.id === marked ? '' : undefined}
                className={styles.row}
                style={{ transform: `translateY(${row.start}px)` }}
              >
                {item.message.role === 'user' ? (
                  <UserMessage item={item} />
                ) : item.compare && conversationId ? (
                  <CompareColumns
                    conversationId={conversationId}
                    group={item.compare}
                    activeId={item.message.id}
                    showCost={showCost}
                    codeTheme={codeTheme}
                  />
                ) : (
                  <AssistantMessage
                    item={item}
                    showCost={showCost}
                    codeTheme={codeTheme}
                    reconnecting={reconnecting.has(item.message.id)}
                    lost={lost.has(item.message.id)}
                  />
                )}
                {item.comparable && !item.compare && item.message.parentId ? (
                  <ShowComparison userMessageId={item.message.parentId} />
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
      {awayFromBottom && items.length > 0 ? (
        <div className={styles.jump}>
          <Button size="sm" className={styles.jumpButton} onClick={jump}>
            <ArrowDown aria-hidden />
            {t('chat.jumpToLatest')}
          </Button>
        </div>
      ) : null}
      <p className={styles.announcer} aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
