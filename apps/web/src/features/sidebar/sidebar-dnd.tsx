import {
  type CollisionDetection,
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ConversationSummary, Folder, ListConversationsResponse } from '@neotext/shared';
import { type InfiniteData, type QueryClient, useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, type ReactNode, useState } from 'react';
import { useT } from '../../lib/i18n';
import { qk } from '../../lib/query';
import styles from './Sidebar.module.css';
import {
  PINNED_QUERY,
  positionAfter,
  positionBetween,
  useConversationMutations,
  useFolderMutations,
} from './use-conversations';

/**
 * Drag a chat onto a folder (move) or into Pinned (pin at that spot); drag pinned chats and
 * folders to reorder them. Keyboard users get the same moves from each row's menu.
 */
type DragData =
  | { type: 'conversation'; conversation: ConversationSummary; pinned: boolean }
  | { type: 'folder'; folder: Folder };

type DropData = DragData | { type: 'pinned-section' };

export const PINNED_SECTION_ID = 'drop:pinned';

/** Pointer first (precise for folders), nearest centre otherwise. */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : closestCenter(args);
};

function pinnedItems(qc: QueryClient): ConversationSummary[] {
  const data = qc.getQueryData<InfiniteData<ListConversationsResponse>>(
    qk.conversations(PINNED_QUERY),
  );
  return data?.pages.flatMap((p) => p.items) ?? [];
}

/** The key for `id` placed at `index` of `order` (ids in their new order). */
function keyAt<T>(order: T[], index: number, position: (x: T) => string | null): string {
  const prev = order[index - 1];
  const next = order[index + 1];
  return positionBetween(prev ? position(prev) : null, next ? position(next) : null);
}

export function SidebarDnd({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const chats = useConversationMutations();
  const folders = useFolderMutations();
  const [dragging, setDragging] = useState<DragData | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  );

  function onDragStart(e: DragStartEvent) {
    setDragging((e.active.data.current as DragData | undefined) ?? null);
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const a = e.active.data.current as DragData | undefined;
    const o = e.over?.data.current as DropData | undefined;
    if (!a || !o || e.active.id === e.over?.id) return;

    if (a.type === 'folder') {
      if (o.type !== 'folder' || o.folder.parentId !== a.folder.parentId) return;
      const siblings = (qc.getQueryData<Folder[]>(qk.folders) ?? [])
        .filter((f) => f.parentId === a.folder.parentId)
        .sort((x, y) => (x.position < y.position ? -1 : 1));
      const from = siblings.findIndex((f) => f.id === a.folder.id);
      const to = siblings.findIndex((f) => f.id === o.folder.id);
      if (from < 0 || to < 0) return;
      const order = arrayMove(siblings, from, to);
      void folders.update(a.folder.id, { position: keyAt(order, to, (f) => f.position) });
      return;
    }

    const c = a.conversation;
    if (o.type === 'folder') {
      if (c.folderId !== o.folder.id) void chats.moveToFolder(c.id, o.folder.id);
      return;
    }
    const pinned = pinnedItems(qc);
    if (o.type === 'pinned-section') {
      if (!c.pinned)
        void chats.setPinned(c.id, true, positionAfter(pinned.map((p) => p.pinPosition)));
      return;
    }
    if (o.type === 'conversation' && o.pinned) {
      if (o.conversation.id === c.id) return; // its own pinned copy
      const to = pinned.findIndex((p) => p.id === o.conversation.id);
      if (to < 0) return;
      const from = pinned.findIndex((p) => p.id === c.id);
      const order =
        from >= 0 ? arrayMove(pinned, from, to) : [...pinned.slice(0, to), c, ...pinned.slice(to)];
      const index = order.findIndex((p) => p.id === c.id);
      void chats.setPinned(
        c.id,
        true,
        keyAt(order, index, (p) => p.pinPosition),
      );
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {dragging ? <DragPreview data={dragging} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function DragPreview({ data }: { data: DragData }) {
  const t = useT();
  const label =
    data.type === 'folder' ? data.folder.name : (data.conversation.title ?? t('sidebar.newChat'));
  return <div className={styles.dragPreview}>{label}</div>;
}

/**
 * One chat can sit in several lists at once (pinned and inside an open folder, or Recent with
 * folders included), so a row's drag id names its list too. Drops read the chat from `data`.
 */
export function chatDragId(listKey: string, conversationId: string): string {
  return `chat:${listKey}:${conversationId}`;
}

export interface DragBinding {
  id: string;
  setNodeRef: (el: HTMLElement | null) => void;
  /** Pointer listeners only: the row's link and menu keep their own keyboard behaviour. */
  listeners: Record<string, (event: never) => void> | undefined;
  style?: CSSProperties;
  isDragging: boolean;
  isOver: boolean;
}

/** A chat in Recent, Archived, a folder or a smart section. */
export function useChatDrag(listKey: string, conversation: ConversationSummary): DragBinding {
  const id = chatDragId(listKey, conversation.id);
  const d = useDraggable({
    id,
    data: { type: 'conversation', conversation, pinned: false } satisfies DragData,
  });
  return {
    id,
    setNodeRef: d.setNodeRef,
    listeners: d.listeners as DragBinding['listeners'],
    isDragging: d.isDragging,
    isOver: false,
  };
}

/** A pinned chat: sortable, and a drop spot for chats dragged into Pinned. */
export function usePinnedSort(listKey: string, conversation: ConversationSummary): DragBinding {
  const id = chatDragId(listKey, conversation.id);
  const s = useSortable({
    id,
    data: { type: 'conversation', conversation, pinned: true } satisfies DragData,
  });
  return {
    id,
    setNodeRef: s.setNodeRef,
    listeners: s.listeners as DragBinding['listeners'],
    style: { transform: CSS.Translate.toString(s.transform), transition: s.transition },
    isDragging: s.isDragging,
    isOver: s.isOver,
  };
}

/** A folder row: sortable among its siblings and a drop target for chats. */
export function useFolderSort(folder: Folder): DragBinding {
  const id = `folder:${folder.id}`;
  const s = useSortable({ id, data: { type: 'folder', folder } satisfies DragData });
  return {
    id,
    setNodeRef: s.setNodeRef,
    listeners: s.listeners as DragBinding['listeners'],
    style: { transform: CSS.Translate.toString(s.transform), transition: s.transition },
    isDragging: s.isDragging,
    isOver: s.isOver && s.active?.data.current?.type === 'conversation',
  };
}

export function usePinnedDrop() {
  return useDroppable({
    id: PINNED_SECTION_ID,
    data: { type: 'pinned-section' } satisfies DropData,
  });
}

export function SortableList({ ids, children }: { ids: string[]; children: ReactNode }) {
  return (
    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
      {children}
    </SortableContext>
  );
}
