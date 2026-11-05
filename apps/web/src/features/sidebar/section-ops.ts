import type { SidebarSection } from '@neotext/shared';
import type { SmartFilterInput } from './smart-filter';

/**
 * Pure edits of the saved section list. Each returns a new array and leaves every section it is
 * not about (unknown kinds included) as the same object in the same relative order, so the whole
 * array can go into a merge patch.
 */

/** Moves `activeId` to where `overId` is (the list shifts around it). Unknown ids change nothing. */
export function moveSection(
  sections: SidebarSection[],
  activeId: string,
  overId: string,
): SidebarSection[] {
  const from = sections.findIndex((s) => s.id === activeId);
  const to = sections.findIndex((s) => s.id === overId);
  if (from < 0 || to < 0 || from === to) return sections;
  const next = [...sections];
  const [moved] = next.splice(from, 1);
  if (moved) next.splice(to, 0, moved);
  return next;
}

export function setSectionVisible(
  sections: SidebarSection[],
  id: string,
  visible: boolean,
): SidebarSection[] {
  return sections.map((s) => (s.id === id ? { ...s, visible } : s));
}

/** A new smart section goes above Archived, which stays last; without Archived it goes last. */
export function addSmartSection(
  sections: SidebarSection[],
  input: { title: string; filter: SmartFilterInput },
  id: string,
): SidebarSection[] {
  const made: SidebarSection = {
    id,
    kind: 'smart',
    visible: true,
    collapsed: false,
    title: input.title,
    // Only the keys that are set are saved; the schema's type lists the rest as undefined.
    filter: input.filter as SidebarSection['filter'],
  };
  const at = sections.findIndex((s) => s.kind === 'archived');
  return at < 0 ? [...sections, made] : [...sections.slice(0, at), made, ...sections.slice(at)];
}

/** Only sections the user made can be removed; built-in ones are hidden instead. */
export function removeSection(sections: SidebarSection[], id: string): SidebarSection[] {
  const target = sections.find((s) => s.id === id);
  if (target?.kind !== 'smart') return sections;
  return sections.filter((s) => s.id !== id);
}
