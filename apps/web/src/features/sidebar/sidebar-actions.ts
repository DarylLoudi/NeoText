import {
  defaultSettings,
  KNOWN_SIDEBAR_KINDS,
  type SidebarSection as Section,
} from '@neotext/shared';
import { updateSettings } from '../../state/settings';

/** Sections are saved as one array: a merge patch replaces arrays whole. */
export const saveSections = (sections: Section[]) => updateSettings({ sidebar: { sections } });

/** Defaults for position, width, quick actions and sections; sections of unknown kinds are kept. */
export function resetSidebar(current: Section[]): void {
  const defaults = defaultSettings().sidebar;
  const unknown = current.filter((s) => !KNOWN_SIDEBAR_KINDS.includes(s.kind));
  updateSettings({
    sidebar: {
      position: defaults.position,
      width: defaults.width,
      quickActions: defaults.quickActions,
      sections: [...defaults.sections, ...unknown],
    },
  });
}

export function newSmartId(sections: Section[]): string {
  let id: string;
  do id = `smart-${crypto.randomUUID().slice(0, 8)}`;
  while (sections.some((s) => s.id === id));
  return id;
}
