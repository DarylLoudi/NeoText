import type { ConversationSummary, Folder } from '@neotext/shared';
import {
  Archive,
  ArrowCounterClockwise,
  ArrowDown,
  ArrowUp,
  DotsThree,
  FolderSimple,
  PencilSimple,
  PushPin,
  PushPinSlash,
  Trash,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type CSSProperties, type Ref, useEffect, useRef, useState } from 'react';
import { useT } from '../../lib/i18n';
import { IconButton, Menu, type MenuItem, Spinner } from '../../ui';
import styles from './ConversationItem.module.css';
import type { DragBinding } from './sidebar-dnd';
import { nextPinPosition, useConversationMutations, useFolders } from './use-conversations';

export interface InlineRenameProps {
  value: string;
  label: string;
  onSave: (value: string) => void;
  /** `byKeyboard` is false when the field lost focus (the user moved elsewhere). */
  onDone: (byKeyboard: boolean) => void;
  className?: string;
}

/** Enter or leaving the field saves a changed, non-empty value; Escape cancels. */
export function InlineRename({ value, label, onSave, onDone, className }: InlineRenameProps) {
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (save: boolean, byKeyboard: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const next = ref.current?.value.trim() ?? '';
    if (save && next && next !== value) onSave(next);
    onDone(byKeyboard);
  };
  return (
    <input
      ref={ref}
      className={className ?? styles.rename}
      aria-label={label}
      defaultValue={value}
      maxLength={200}
      dir="auto"
      onBlur={() => finish(true, false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          finish(true, true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(false, true);
        }
      }}
    />
  );
}

/** Folders in tree order, labelled with their path ("Thesis / Chapter 2"). */
function folderPaths(folders: Folder[]): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const walk = (parentId: string | null, prefix: string) => {
    const level = folders
      .filter((f) => f.parentId === parentId)
      .sort((a, b) => (a.position < b.position ? -1 : 1));
    for (const f of level) {
      const label = prefix ? `${prefix} / ${f.name}` : f.name;
      out.push({ id: f.id, label });
      walk(f.id, label);
    }
  };
  walk(null, '');
  return out;
}

/** The next chat in the same list, else the previous one, else the section's heading. */
function focusTargetAfter(row: HTMLElement | null): HTMLElement | null {
  const list = row?.parentElement;
  if (!row || !list) return null;
  const links = [...list.querySelectorAll<HTMLElement>(':scope > li a[href]')];
  const mine = links.findIndex((a) => row.contains(a));
  const other = mine >= 0 ? (links[mine + 1] ?? links[mine - 1]) : undefined;
  return other ?? row.closest('section')?.querySelector<HTMLElement>('h2 button') ?? null;
}

/** A row's keyboard reorder, as menu items: null at the end it cannot move past. */
export interface RowMoves {
  up: (() => void) | null;
  down: (() => void) | null;
}

/** "Move up" and "Move down" for a row's menu (pinned chats and folders). */
export function moveMenuItems(moves: RowMoves, t: ReturnType<typeof useT>): MenuItem[] {
  return [
    {
      label: t('sidebar.moveUp'),
      icon: <ArrowUp />,
      disabled: moves.up === null,
      onSelect: () => moves.up?.(),
    },
    {
      label: t('sidebar.moveDown'),
      icon: <ArrowDown />,
      disabled: moves.down === null,
      onSelect: () => moves.down?.(),
    },
  ];
}

export interface ConversationItemProps {
  conversation: ConversationSummary;
  active: boolean;
  generating: boolean;
  drag?: DragBinding;
  /** Set in Pinned, where the order is the user's own. */
  moves?: RowMoves;
  /** Positioning from a virtual list. */
  style?: CSSProperties;
  measureRef?: Ref<HTMLLIElement>;
  index?: number;
}

export function ConversationItem({
  conversation: c,
  active,
  generating,
  drag,
  moves,
  style,
  measureRef,
  index,
}: ConversationItemProps) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const mutations = useConversationMutations();
  const folders = useFolders().data ?? [];
  const [renaming, setRenaming] = useState(false);
  const renameNext = useRef(false);
  const rowRef = useRef<HTMLLIElement | null>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const refocusLink = useRef(false);
  /** Where focus goes once this row is deleted (set when Delete is chosen). */
  const focusAfterDelete = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (renaming || !refocusLink.current) return;
    refocusLink.current = false;
    linkRef.current?.focus();
  }, [renaming]);
  const title = c.title ?? t('sidebar.newChat');

  const moveItems: MenuItem[] = [
    ...(c.folderId
      ? [
          {
            id: 'no-folder',
            label: t('sidebar.noFolder'),
            onSelect: () => void mutations.moveToFolder(c.id, null),
          },
        ]
      : []),
    ...folderPaths(folders).map((f) => ({
      id: f.id,
      label: f.label,
      disabled: f.id === c.folderId,
      onSelect: () => void mutations.moveToFolder(c.id, f.id),
    })),
  ];

  const items: MenuItem[] = [
    {
      label: t('sidebar.rename'),
      icon: <PencilSimple />,
      onSelect: () => {
        renameNext.current = true;
        setRenaming(true);
      },
    },
    c.pinned
      ? {
          label: t('sidebar.unpin'),
          icon: <PushPinSlash />,
          onSelect: () => void mutations.setPinned(c.id, false, null),
        }
      : {
          label: t('sidebar.pin'),
          icon: <PushPin />,
          onSelect: () => {
            void nextPinPosition(qc).then((at) => mutations.setPinned(c.id, true, at));
          },
        },
    ...(moves ? moveMenuItems(moves, t) : []),
    {
      label: t('sidebar.moveToFolder'),
      icon: <FolderSimple />,
      items: moveItems,
      disabled: moveItems.length === 0,
    },
    c.archived
      ? {
          label: t('sidebar.unarchive'),
          icon: <ArrowCounterClockwise />,
          onSelect: () => void mutations.setArchived(c.id, false),
        }
      : {
          label: t('sidebar.archive'),
          icon: <Archive />,
          onSelect: () => void mutations.setArchived(c.id, true),
        },
    { separator: true },
    {
      label: t('sidebar.delete'),
      icon: <Trash />,
      danger: true,
      onSelect: () => {
        focusAfterDelete.current = focusTargetAfter(rowRef.current);
        void mutations.remove(c.id).then((ok) => {
          if (ok && active) void navigate({ to: '/' });
        });
      },
    },
  ];

  const setRefs = (el: HTMLLIElement | null) => {
    rowRef.current = el;
    drag?.setNodeRef(el);
    if (typeof measureRef === 'function') measureRef(el);
  };

  return (
    <li
      ref={setRefs}
      className={styles.row}
      style={{ ...style, ...drag?.style }}
      data-index={index}
      data-drag-id={drag?.id}
      data-active={active || undefined}
      data-dragging={drag?.isDragging || undefined}
      data-over={drag?.isOver || undefined}
      {...drag?.listeners}
    >
      {renaming ? (
        <InlineRename
          value={c.title ?? ''}
          label={t('sidebar.titleLabel')}
          onSave={(next) => void mutations.rename(c.id, next)}
          onDone={(byKeyboard) => {
            refocusLink.current = byKeyboard;
            setRenaming(false);
          }}
        />
      ) : (
        <Link
          ref={linkRef}
          to="/c/$conversationId"
          params={{ conversationId: c.id }}
          className={styles.link}
          aria-current={active ? 'page' : undefined}
          draggable={false}
        >
          <span className={styles.title} dir="auto">
            {title}
          </span>
        </Link>
      )}
      {generating ? (
        <span className={styles.status}>
          <Spinner label={t('sidebar.generating')} size={12} />
        </span>
      ) : null}
      {renaming ? null : (
        <span className={styles.menu}>
          <Menu
            align="end"
            items={items}
            onCloseAutoFocus={(e) => {
              if (renameNext.current) {
                renameNext.current = false;
                e.preventDefault();
              } else if (focusAfterDelete.current) {
                // The trigger is about to disappear with its row.
                e.preventDefault();
                focusAfterDelete.current.focus();
                focusAfterDelete.current = null;
              }
            }}
            trigger={
              <IconButton size="sm" label={t('sidebar.rowMenu', { title })} icon={<DotsThree />} />
            }
          />
        </span>
      )}
    </li>
  );
}
