import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { KNOWN_SIDEBAR_KINDS, type SidebarSection as Section } from '@neotext/shared';
import { ArrowDown, ArrowUp, DotsSixVertical, Plus, Trash } from '@phosphor-icons/react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../lib/i18n';
import { updateSettings, useSettings } from '../../state/settings';
import { Button, Dialog, IconButton, Switch } from '../../ui';
import { ChoiceGroup } from './ChoiceGroup';
import styles from './SidebarCustomizer.module.css';
import { AddSmartSectionDialog, ResetSidebarDialog } from './SidebarDialogs';
import { clampWidth, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH } from './SidebarResizer';
import { isDrawnKind } from './SidebarSection';
import { moveSection, removeSection, setSectionVisible } from './section-ops';
import { saveSections } from './sidebar-actions';

const QUICK_ACTIONS = ['new-chat', 'search', 'compare'] as const;
const QUICK_ACTION_LABELS = {
  'new-chat': 'sidebar.newChat',
  search: 'sidebar.search',
  compare: 'chat.compare.toggle',
} as const;

function useSectionTitle(): (section: Section) => string {
  const t = useT();
  return (section) =>
    section.title ??
    (KNOWN_SIDEBAR_KINDS.includes(section.kind) ? t(`sidebar.sections.${section.kind}`) : '');
}

interface RowProps {
  section: Section;
  title: string;
  first: boolean;
  last: boolean;
  onVisible: (visible: boolean) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}

function SectionRow({ section, title, first, last, onVisible, onMove, onRemove }: RowProps) {
  const t = useT();
  const sort = useSortable({ id: section.id });
  const style = {
    transform: CSS.Translate.toString(sort.transform && { ...sort.transform, x: 0 }),
    transition: sort.transition,
  };
  return (
    <li
      ref={sort.setNodeRef}
      className={styles.row}
      style={style}
      data-dragging={sort.isDragging || undefined}
    >
      <button
        type="button"
        className={styles.handle}
        ref={sort.setActivatorNodeRef}
        aria-label={t('sidebar.customizer.reorder', { title })}
        {...sort.attributes}
        {...sort.listeners}
      >
        <DotsSixVertical aria-hidden />
      </button>
      <div className={styles.switch}>
        <Switch label={title} checked={section.visible} onChange={onVisible} />
      </div>
      <div className={styles.tools}>
        {section.kind === 'smart' ? (
          <IconButton
            size="sm"
            label={t('sidebar.customizer.remove', { title })}
            icon={<Trash />}
            onClick={onRemove}
          />
        ) : null}
        <IconButton
          size="sm"
          label={t('sidebar.customizer.moveUp', { title })}
          icon={<ArrowUp />}
          disabled={first}
          onClick={() => onMove(-1)}
        />
        <IconButton
          size="sm"
          label={t('sidebar.customizer.moveDown', { title })}
          icon={<ArrowDown />}
          disabled={last}
          onClick={() => onMove(1)}
        />
      </div>
    </li>
  );
}

export function SectionList() {
  const t = useT();
  const titleOf = useSectionTitle();
  const sections = useSettings((s) => s.settings.sidebar.sections);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Sections of kinds this version cannot draw stay saved and in place; they are just not listed.
  const shown = sections.filter((s) => isDrawnKind(s.kind));
  const nameOf = (id: string | number) => {
    const s = shown.find((x) => x.id === id);
    return s ? titleOf(s) : '';
  };
  const place = (id: string | number) => shown.findIndex((x) => x.id === id) + 1;

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    saveSections(moveSection(sections, String(e.active.id), String(e.over.id)));
  };
  const step = (index: number, direction: -1 | 1) => {
    const neighbour = shown[index + direction];
    const section = shown[index];
    if (neighbour && section) saveSections(moveSection(sections, section.id, neighbour.id));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        screenReaderInstructions: { draggable: t('sidebar.customizer.dragHelp') },
        announcements: {
          onDragStart: ({ active }) =>
            t('sidebar.customizer.picked', { title: nameOf(active.id), n: place(active.id) }),
          onDragOver: ({ active, over }) =>
            over
              ? t('sidebar.customizer.over', { title: nameOf(active.id), n: place(over.id) })
              : undefined,
          onDragEnd: ({ active, over }) =>
            t('sidebar.customizer.dropped', {
              title: nameOf(active.id),
              n: place(over ? over.id : active.id),
            }),
          onDragCancel: ({ active }) =>
            t('sidebar.customizer.cancelled', { title: nameOf(active.id) }),
        },
      }}
    >
      <SortableContext items={shown.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        <ul className={styles.list} aria-label={t('sidebar.customizer.sections')}>
          {shown.map((section, index) => (
            <SectionRow
              key={section.id}
              section={section}
              title={titleOf(section)}
              first={index === 0}
              last={index === shown.length - 1}
              onVisible={(visible) =>
                saveSections(setSectionVisible(sections, section.id, visible))
              }
              onMove={(direction) => step(index, direction)}
              onRemove={() => saveSections(removeSection(sections, section.id))}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

/**
 * The width slider shows its value while it moves and saves once, on release (pointer up, key
 * up or the native `change`), like the drag handle: a drag is one edit, not one per pixel.
 */
function WidthSlider({ width }: { width: number }) {
  const t = useT();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [moving, setMoving] = useState<number | null>(null);
  /** The width last saved; release fires several events and only the first one saves. */
  const saved = useRef(width);
  saved.current = width;
  const commit = useCallback(() => {
    const el = input.current;
    if (!el) return;
    const next = clampWidth(Number(el.value));
    setMoving(null);
    if (next === saved.current) return;
    saved.current = next;
    updateSettings({ sidebar: { width: next } });
  }, []);
  // React's onChange is the native `input` event; the native `change` fires on release.
  useEffect(() => {
    const el = input.current;
    el?.addEventListener('change', commit);
    return () => el?.removeEventListener('change', commit);
  }, [commit]);
  const shown = moving ?? width;
  return (
    <div className={styles.width}>
      <label htmlFor={id} className={styles.fieldLabel}>
        {t('sidebar.customizer.width')}
      </label>
      <input
        ref={input}
        id={id}
        className={styles.range}
        type="range"
        min={MIN_SIDEBAR_WIDTH}
        max={MAX_SIDEBAR_WIDTH}
        step={4}
        value={shown}
        onChange={(e) => {
          // The release's `change` has already been saved by the listener above.
          if (e.nativeEvent.type !== 'change') setMoving(clampWidth(Number(e.target.value)));
        }}
        onPointerUp={commit}
        onKeyUp={commit}
      />
      <output htmlFor={id} className={styles.value}>
        {t('sidebar.customizer.pixels', { count: shown })}
      </output>
    </div>
  );
}

export function LayoutControls() {
  const t = useT();
  const sidebar = useSettings((s) => s.settings.sidebar);
  const density = useSettings((s) => s.settings.appearance.density);
  const toggleAction = (action: (typeof QUICK_ACTIONS)[number], on: boolean) => {
    const rest = sidebar.quickActions.filter((a) => a !== action);
    updateSettings({ sidebar: { quickActions: on ? [...rest, action] : rest } });
  };
  return (
    <>
      <div className={styles.choices}>
        <ChoiceGroup
          legend={t('sidebar.customizer.position')}
          value={sidebar.position}
          onChange={(position) => updateSettings({ sidebar: { position } })}
          options={[
            { value: 'left', label: t('sidebar.customizer.left') },
            { value: 'right', label: t('sidebar.customizer.right') },
          ]}
        />
        <ChoiceGroup
          legend={t('sidebar.customizer.density')}
          value={density}
          onChange={(next) => updateSettings({ appearance: { density: next } })}
          options={[
            { value: 'comfortable', label: t('sidebar.customizer.comfortable') },
            { value: 'compact', label: t('sidebar.customizer.compact') },
          ]}
        />
      </div>
      <WidthSlider width={sidebar.width} />
      <fieldset className={styles.quick}>
        <legend className={styles.fieldLabel}>{t('sidebar.customizer.quickActions')}</legend>
        {QUICK_ACTIONS.map((action) => (
          <label key={action} className={styles.check}>
            <input
              type="checkbox"
              checked={sidebar.quickActions.includes(action)}
              onChange={(e) => toggleAction(action, e.target.checked)}
            />
            {t(QUICK_ACTION_LABELS[action])}
          </label>
        ))}
      </fieldset>
    </>
  );
}

export interface SidebarCustomizerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SidebarCustomizer({ open, onOpenChange }: SidebarCustomizerProps) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        size="md"
        title={t('sidebar.customize')}
        description={t('sidebar.customizer.description')}
        footer={
          <>
            <Button
              variant="ghost"
              className={styles.reset}
              onClick={() => setConfirmingReset(true)}
            >
              {t('sidebar.customizer.reset')}
            </Button>
            <Button variant="primary" onClick={() => onOpenChange(false)}>
              {t('sidebar.customizer.done')}
            </Button>
          </>
        }
      >
        <div className={styles.body}>
          <section className={styles.group}>
            <h3 className={styles.heading}>{t('sidebar.customizer.sections')}</h3>
            <SectionList />
            <Button size="sm" className={styles.add} onClick={() => setAdding(true)}>
              <Plus aria-hidden />
              {t('sidebar.smart.title')}
            </Button>
          </section>
          <section className={styles.group}>
            <h3 className={styles.heading}>{t('sidebar.customizer.layout')}</h3>
            <LayoutControls />
          </section>
        </div>
      </Dialog>
      <AddSmartSectionDialog open={adding} onOpenChange={setAdding} />
      <ResetSidebarDialog open={confirmingReset} onOpenChange={setConfirmingReset} />
    </>
  );
}
