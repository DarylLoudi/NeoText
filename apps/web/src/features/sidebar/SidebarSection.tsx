import type { ListQuery, SidebarSection as Section } from '@neotext/shared';
import { CaretDown } from '@phosphor-icons/react';
import { type ReactNode, useId } from 'react';
import { useT } from '../../lib/i18n';
import { updateSettings } from '../../state/settings';
import { Spinner } from '../../ui';
import { PresetsSection } from '../presets/PresetsSection';
import { ConversationList } from './ConversationList';
import { FolderTree } from './FolderTree';
import styles from './SidebarSection.module.css';
import { usePinnedDrop } from './sidebar-dnd';
import { useSmartQuery } from './smart-filter';
import { PINNED_QUERY, useActiveConversationIds, useConversationList } from './use-conversations';

/** Kinds this version draws. Others (newer versions, later plans) render nothing but stay saved. */
const DRAWN = new Set(['pinned', 'folders', 'recent', 'presets', 'archived', 'smart']);

/** Whether this version has a drawing for sections of `kind` (hidden or not). */
export function isDrawnKind(kind: string): boolean {
  return DRAWN.has(kind);
}

export function isDrawnSection(section: Section): boolean {
  return section.visible && isDrawnKind(section.kind);
}

function Frame({
  section,
  sections,
  title,
  children,
}: {
  section: Section;
  sections: Section[];
  title: string;
  children: ReactNode;
}) {
  const headingId = useId();
  const bodyId = useId();
  const open = !section.collapsed;
  const toggle = () => {
    // Arrays replace as a whole in a merge patch, so the patch carries every section.
    updateSettings({
      sidebar: {
        sections: sections.map((s) => (s.id === section.id ? { ...s, collapsed: open } : s)),
      },
    });
  };
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 className={styles.heading} id={headingId}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={toggle}
        >
          <span>{title}</span>
          <CaretDown className={styles.caret} data-open={open || undefined} aria-hidden />
        </button>
      </h2>
      <div id={bodyId} hidden={!open}>
        {open ? children : null}
      </div>
    </section>
  );
}

function ListBody({
  query,
  listKey,
  label,
  emptyText,
  groupByDate,
  sortable,
}: {
  query: Partial<ListQuery>;
  listKey: string;
  label: string;
  emptyText: string;
  groupByDate?: boolean;
  sortable?: boolean;
}) {
  const t = useT();
  const list = useConversationList(query);
  const activeIds = useActiveConversationIds();
  if (list.isPending) {
    return (
      <p className={styles.note}>
        <Spinner label={t('common.loading')} size={12} />
      </p>
    );
  }
  if (list.isError) return <p className={styles.note}>{t('sidebar.loadFailed')}</p>;
  if (list.items.length === 0) return <p className={styles.note}>{emptyText}</p>;
  return (
    <ConversationList
      label={label}
      listKey={listKey}
      items={list.items}
      groupByDate={groupByDate}
      sortable={sortable}
      activeIds={activeIds}
      hasNextPage={list.hasNextPage}
      isFetchingNextPage={list.isFetchingNextPage}
      fetchNextPage={() => void list.fetchNextPage()}
    />
  );
}

function PinnedDropZone({ children }: { children: ReactNode }) {
  const drop = usePinnedDrop();
  return (
    <div ref={drop.setNodeRef} className={styles.dropZone} data-over={drop.isOver || undefined}>
      {children}
    </div>
  );
}

function SmartBody({ section, title }: { section: Section; title: string }) {
  const t = useT();
  return (
    <ListBody
      listKey={section.id}
      query={useSmartQuery(section.filter)}
      label={title}
      emptyText={t('sidebar.smartEmpty')}
    />
  );
}

export function SidebarSection({ section, sections }: { section: Section; sections: Section[] }) {
  const t = useT();
  if (!isDrawnSection(section)) return null;
  const title = section.title ?? t(`sidebar.sections.${section.kind}`);
  const frame = (body: ReactNode) => (
    <Frame section={section} sections={sections} title={title}>
      {body}
    </Frame>
  );
  switch (section.kind) {
    case 'pinned':
      return (
        <PinnedDropZone>
          {frame(
            <ListBody
              listKey={section.id}
              query={PINNED_QUERY}
              label={title}
              emptyText={t('sidebar.pinnedEmpty')}
              sortable
            />,
          )}
        </PinnedDropZone>
      );
    case 'folders':
      return frame(<FolderTree />);
    case 'recent':
      return frame(
        <ListBody
          listKey={section.id}
          query={
            section.includeFoldered
              ? { scope: 'recent', includeFoldered: true }
              : { scope: 'recent' }
          }
          label={title}
          emptyText={t('sidebar.empty')}
          groupByDate={section.groupBy !== 'none'}
        />,
      );
    case 'presets':
      return frame(<PresetsSection />);
    case 'archived':
      return frame(
        <ListBody
          listKey={section.id}
          query={{ scope: 'archived' }}
          label={title}
          emptyText={t('sidebar.archivedEmpty')}
        />,
      );
    case 'smart':
      return frame(<SmartBody section={section} title={title} />);
    default:
      return null;
  }
}
