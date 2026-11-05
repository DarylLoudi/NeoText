import type { Folder } from '@neotext/shared';
import {
  CaretRight,
  DotsThree,
  FolderPlus,
  Palette,
  PencilSimple,
  Trash,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../lib/i18n';
import { Button, Dialog, IconButton, Menu, type MenuItem, Spinner } from '../../ui';
import { InlineRename, moveMenuItems } from './ConversationItem';
import { ConversationList } from './ConversationList';
import styles from './FolderTree.module.css';
import { stepPosition } from './reorder';
import { SortableList, useFolderSort } from './sidebar-dnd';
import {
  useActiveConversationIds,
  useConversationList,
  useFolderMutations,
  useFolders,
} from './use-conversations';

/**
 * The API stores a folder color as hex, so each palette entry is saved under its light-theme
 * value and drawn with its `--folder-*` token (which has a dark-theme value too). Marker yellow
 * is reserved for the marker; any other stored value, older marker folders included, draws as
 * graphite.
 */
const FOLDER_COLORS = {
  mint: '#9EE6C4',
  sky: '#A7D3F5',
  rose: '#F5B3C2',
  graphite: '#C9CDD3',
} as const;
type FolderColor = keyof typeof FOLDER_COLORS;

function colorName(stored: string): FolderColor {
  const hit = Object.entries(FOLDER_COLORS).find(
    ([, id]) => id.toLowerCase() === stored.toLowerCase(),
  );
  return (hit?.[0] as FolderColor | undefined) ?? 'graphite';
}

const colorVar = (name: FolderColor) => `var(--folder-${name})`;

function byPosition(a: Folder, b: Folder): number {
  if (a.position === b.position) return a.id < b.id ? -1 : 1;
  return a.position < b.position ? -1 : 1;
}

function FolderChats({ folder }: { folder: Folder }) {
  const t = useT();
  const list = useConversationList({ scope: 'folder', folderId: folder.id });
  const activeIds = useActiveConversationIds();
  if (list.isPending) {
    return (
      <p className={styles.note}>
        <Spinner label={t('common.loading')} size={12} />
      </p>
    );
  }
  if (list.isError) return <p className={styles.note}>{t('sidebar.loadFailed')}</p>;
  if (list.items.length === 0) return <p className={styles.note}>{t('sidebar.folderEmpty')}</p>;
  return (
    <ConversationList
      label={folder.name}
      listKey={`folder:${folder.id}`}
      items={list.items}
      activeIds={activeIds}
      hasNextPage={list.hasNextPage}
      isFetchingNextPage={list.isFetchingNextPage}
      fetchNextPage={() => void list.fetchNextPage()}
    />
  );
}

interface NodeProps {
  folder: Folder;
  /** Its new position one place up or down among its siblings; null at that end. */
  upKey: string | null;
  downKey: string | null;
  childrenOf: Map<string | null, Folder[]>;
  expanded: ReadonlySet<string>;
  toggle: (id: string) => void;
}

function FolderNode({ folder, upKey, downKey, childrenOf, expanded, toggle }: NodeProps) {
  const t = useT();
  const mutations = useFolderMutations();
  const drag = useFolderSort(folder);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const renameNext = useRef(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const refocusToggle = useRef(false);
  useEffect(() => {
    if (renaming || !refocusToggle.current) return;
    refocusToggle.current = false;
    toggleRef.current?.focus();
  }, [renaming]);
  const open = expanded.has(folder.id);
  const kids = childrenOf.get(folder.id) ?? [];

  const colors: MenuItem[] = [
    ...(Object.keys(FOLDER_COLORS) as FolderColor[]).map((name) => ({
      id: name,
      label: t(`sidebar.colors.${name}`),
      icon: <span className={styles.swatch} style={{ backgroundColor: colorVar(name) }} />,
      disabled: folder.color !== null && colorName(folder.color) === name,
      onSelect: () => void mutations.update(folder.id, { color: FOLDER_COLORS[name] }),
    })),
    { separator: true },
    {
      id: 'none',
      label: t('sidebar.noColor'),
      disabled: folder.color === null,
      onSelect: () => void mutations.update(folder.id, { color: null }),
    },
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
    { label: t('sidebar.color'), icon: <Palette />, items: colors },
    ...moveMenuItems(
      {
        up: upKey === null ? null : () => void mutations.update(folder.id, { position: upKey }),
        down:
          downKey === null ? null : () => void mutations.update(folder.id, { position: downKey }),
      },
      t,
    ),
    { separator: true },
    {
      label: t('sidebar.deleteFolder'),
      icon: <Trash />,
      danger: true,
      onSelect: () => setConfirming(true),
    },
  ];

  return (
    <li className={styles.node} style={drag.style}>
      <div
        ref={drag.setNodeRef}
        className={styles.row}
        data-over={drag.isOver || undefined}
        data-dragging={drag.isDragging || undefined}
        {...drag.listeners}
      >
        {renaming ? (
          <InlineRename
            value={folder.name}
            label={t('sidebar.folderName')}
            onSave={(name) => void mutations.update(folder.id, { name })}
            onDone={(byKeyboard) => {
              refocusToggle.current = byKeyboard;
              setRenaming(false);
            }}
          />
        ) : (
          <button
            ref={toggleRef}
            type="button"
            className={styles.toggle}
            aria-expanded={open}
            onClick={() => toggle(folder.id)}
          >
            <CaretRight className={styles.caret} data-open={open || undefined} aria-hidden />
            {folder.color ? (
              <span
                className={styles.dot}
                style={{ backgroundColor: colorVar(colorName(folder.color)) }}
                data-folder-dot
                aria-hidden
              />
            ) : null}
            <span className={styles.name} dir="auto">
              {folder.name}
            </span>
          </button>
        )}
        {renaming ? null : (
          <span className={styles.menu}>
            <Menu
              align="end"
              items={items}
              onCloseAutoFocus={(e) => {
                if (renameNext.current) {
                  renameNext.current = false;
                  e.preventDefault();
                }
              }}
              trigger={
                <IconButton
                  size="sm"
                  label={t('sidebar.folderMenu', { name: folder.name })}
                  icon={<DotsThree />}
                />
              }
            />
          </span>
        )}
      </div>
      {open ? (
        <div className={styles.children}>
          {kids.length > 0 ? (
            <FolderLevel
              folders={kids}
              childrenOf={childrenOf}
              expanded={expanded}
              toggle={toggle}
            />
          ) : null}
          <FolderChats folder={folder} />
        </div>
      ) : null}
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        size="sm"
        title={t('sidebar.deleteFolderTitle', { name: folder.name })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirming(false);
                void mutations.remove(folder.id);
              }}
            >
              {t('sidebar.deleteFolder')}
            </Button>
          </>
        }
      >
        <p>{t('sidebar.deleteFolderBody')}</p>
      </Dialog>
    </li>
  );
}

type LevelProps = Omit<NodeProps, 'folder' | 'upKey' | 'downKey'> & {
  folders: Folder[];
  label?: string;
};

function FolderLevel(props: LevelProps) {
  const { folders, label, ...rest } = props;
  const positions = folders.map((f) => f.position);
  return (
    <SortableList ids={folders.map((f) => `folder:${f.id}`)}>
      <ul className={styles.level} aria-label={label}>
        {folders.map((f, i) => (
          <FolderNode
            key={f.id}
            folder={f}
            upKey={stepPosition(positions, i, -1)}
            downKey={stepPosition(positions, i, 1)}
            {...rest}
          />
        ))}
      </ul>
    </SortableList>
  );
}

export function FolderTree() {
  const t = useT();
  const { data: folders = [], isError } = useFolders();
  const mutations = useFolderMutations();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [creating, setCreating] = useState(false);

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, Folder[]>();
    const ids = new Set(folders.map((f) => f.id));
    for (const f of [...folders].sort(byPosition)) {
      // A folder whose parent is gone shows at the top level instead of disappearing.
      const parent = f.parentId && ids.has(f.parentId) ? f.parentId : null;
      map.set(parent, [...(map.get(parent) ?? []), f]);
    }
    return map;
  }, [folders]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className={styles.tree}>
      {isError ? <p className={styles.note}>{t('sidebar.loadFailed')}</p> : null}
      <FolderLevel
        folders={childrenOf.get(null) ?? []}
        label={t('sidebar.sections.folders')}
        childrenOf={childrenOf}
        expanded={expanded}
        toggle={toggle}
      />
      {creating ? (
        <div className={styles.row}>
          <InlineRename
            value=""
            label={t('sidebar.folderName')}
            onSave={(name) => void mutations.create(name, null)}
            onDone={() => setCreating(false)}
          />
        </div>
      ) : (
        <button type="button" className={styles.newFolder} onClick={() => setCreating(true)}>
          <FolderPlus aria-hidden />
          {t('sidebar.newFolder')}
        </button>
      )}
    </div>
  );
}
