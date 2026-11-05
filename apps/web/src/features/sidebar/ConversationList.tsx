import type { ConversationSummary } from '@neotext/shared';
import { useParams } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { formatMonth } from '../../lib/format';
import { getLocale, useT } from '../../lib/i18n';
import { ConversationItem } from './ConversationItem';
import styles from './ConversationList.module.css';
import { type ConversationGroup, groupConversations } from './grouping';
import { stepPosition } from './reorder';
import { chatDragId, SortableList, useChatDrag, usePinnedSort } from './sidebar-dnd';
import { useConversationMutations } from './use-conversations';

/** The sidebar's scroll container; every list in it virtualizes against this one element. */
export const SidebarScroll = createContext<HTMLElement | null>(null);

type Row =
  | { type: 'header'; key: string; group: ConversationGroup }
  | { type: 'item'; key: string; conversation: ConversationSummary };

export interface ConversationListProps {
  /** Accessible name of the list. */
  label: string;
  /** Unique per list in the sidebar (section id, `folder:<id>`); part of each row's drag id. */
  listKey: string;
  items: ConversationSummary[];
  groupByDate?: boolean;
  /** Pinned chats: short (server caps it), not virtualized, sortable by drag. */
  sortable?: boolean;
  activeIds: ReadonlySet<string>;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => void;
}

function useOpenConversationId(): string | undefined {
  const params = useParams({ strict: false }) as { conversationId?: string };
  return params.conversationId;
}

function GroupLabel({ group }: { group: ConversationGroup }) {
  const t = useT();
  const { bucket } = group;
  const text =
    bucket.kind === 'month'
      ? formatMonth(bucket.year, bucket.month, getLocale())
      : t(`sidebar.${bucket.kind}`);
  return <h3 className={styles.groupLabel}>{text}</h3>;
}

function DraggableItem(props: {
  listKey: string;
  conversation: ConversationSummary;
  active: boolean;
  generating: boolean;
  start: number;
  index: number;
  measureRef: (el: HTMLElement | null) => void;
}) {
  const drag = useChatDrag(props.listKey, props.conversation);
  return (
    <ConversationItem
      conversation={props.conversation}
      active={props.active}
      generating={props.generating}
      drag={drag}
      index={props.index}
      measureRef={props.measureRef}
      style={{ transform: `translateY(${props.start}px)` }}
    />
  );
}

function PinnedItem({
  listKey,
  upKey,
  downKey,
  ...props
}: {
  listKey: string;
  conversation: ConversationSummary;
  active: boolean;
  generating: boolean;
  /** Its new pin position one place up or down; null at that end. */
  upKey: string | null;
  downKey: string | null;
}) {
  const drag = usePinnedSort(listKey, props.conversation);
  const { setPinned } = useConversationMutations();
  const id = props.conversation.id;
  const moves = {
    up: upKey === null ? null : () => void setPinned(id, true, upKey),
    down: downKey === null ? null : () => void setPinned(id, true, downKey),
  };
  return <ConversationItem {...props} drag={drag} moves={moves} />;
}

/** Offset of the list inside the scroll container, kept current as sections above change size. */
function useScrollMargin(list: HTMLElement | null, scroller: HTMLElement | null): number {
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    if (!list || !scroller) return;
    const measure = () => {
      const next =
        list.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      setMargin((m) => (Math.abs(m - next) < 1 ? m : next));
    };
    measure();
    const content = scroller.firstElementChild;
    if (typeof ResizeObserver === 'undefined' || !content) return;
    const ro = new ResizeObserver(measure);
    ro.observe(content);
    return () => ro.disconnect();
  }, [list, scroller]);
  return margin;
}

const ROW_ESTIMATE = 34;
const HEADER_ESTIMATE = 30;

export function ConversationList(props: ConversationListProps) {
  const openId = useOpenConversationId();
  if (props.sortable) {
    const positions = props.items.map((c) => c.pinPosition);
    return (
      <SortableList ids={props.items.map((c) => chatDragId(props.listKey, c.id))}>
        <ul className={styles.plain} aria-label={props.label}>
          {props.items.map((c, i) => (
            <PinnedItem
              key={c.id}
              listKey={props.listKey}
              conversation={c}
              active={c.id === openId}
              generating={props.activeIds.has(c.id)}
              upKey={stepPosition(positions, i, -1)}
              downKey={stepPosition(positions, i, 1)}
            />
          ))}
        </ul>
      </SortableList>
    );
  }
  return <VirtualList {...props} openId={openId} />;
}

function VirtualList({
  label,
  listKey,
  items,
  groupByDate,
  activeIds,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  openId,
}: ConversationListProps & { openId: string | undefined }) {
  const scroller = useContext(SidebarScroll);
  const [listEl, setListEl] = useState<HTMLUListElement | null>(null);
  const scrollMargin = useScrollMargin(listEl, scroller);

  const rows = useMemo<Row[]>(() => {
    if (!groupByDate) return items.map((c) => ({ type: 'item', key: c.id, conversation: c }));
    return groupConversations(items, Date.now()).flatMap((group): Row[] => [
      { type: 'header', key: `h:${group.key}`, group },
      ...group.items.map((c): Row => ({ type: 'item', key: c.id, conversation: c })),
    ]);
  }, [items, groupByDate]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize: (i) => (rows[i]?.type === 'header' ? HEADER_ESTIMATE : ROW_ESTIMATE),
    getItemKey: (i) => rows[i]?.key ?? i,
    overscan: 8,
    scrollMargin,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex = virtualItems.at(-1)?.index ?? -1;

  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && lastIndex >= rows.length - 8) fetchNextPage?.();
  }, [hasNextPage, isFetchingNextPage, lastIndex, rows.length, fetchNextPage]);

  return (
    <ul
      ref={setListEl}
      className={styles.virtual}
      aria-label={label}
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualItems.map((v) => {
        const row = rows[v.index];
        if (!row) return null;
        const start = v.start - scrollMargin;
        if (row.type === 'header') {
          return (
            <li
              key={row.key}
              ref={virtualizer.measureElement}
              data-index={v.index}
              className={styles.headerRow}
              style={{ transform: `translateY(${start}px)` }}
            >
              <GroupLabel group={row.group} />
            </li>
          );
        }
        const c = row.conversation;
        return (
          <DraggableItem
            key={row.key}
            listKey={listKey}
            conversation={c}
            active={c.id === openId}
            generating={activeIds.has(c.id)}
            start={start}
            index={v.index}
            measureRef={virtualizer.measureElement}
          />
        );
      })}
    </ul>
  );
}
