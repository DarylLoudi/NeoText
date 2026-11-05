import type { ConversationSummary } from '@neotext/shared';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import type { ActionId } from '../../lib/hotkeys';
import { SECTIONS, type SectionId } from '../settings/section-ids';

export type Theme = 'system' | 'light' | 'dark';

/** One row in the Actions group. */
export interface PaletteCommand {
  id: string;
  label: string;
  /** Other words that find it. */
  keywords: string[];
  /** Shows this action's current keys beside the row. */
  shortcut?: ActionId;
  run: () => void;
}

export interface CommandDeps {
  t: TFunction;
  theme: Theme;
  newChat: () => void;
  toggleSidebar: () => void;
  openSettings: (section: SectionId) => void;
  setTheme: (theme: Theme) => void;
}

const THEMES: { theme: Theme; key: string; words: string[] }[] = [
  { theme: 'light', key: 'themeLight', words: ['theme', 'light', 'appearance', 'terang'] },
  { theme: 'dark', key: 'themeDark', words: ['theme', 'dark', 'night', 'appearance', 'gelap'] },
  {
    theme: 'system',
    key: 'themeSystem',
    words: ['theme', 'system', 'auto', 'appearance', 'sistem'],
  },
];

/** The palette's actions, in the order they are listed. */
export function buildCommands(d: CommandDeps): PaletteCommand[] {
  const commands: PaletteCommand[] = [
    {
      id: 'new-chat',
      label: d.t('shell.palette.commands.newChat'),
      keywords: ['new', 'start', 'compose', 'baru'],
      shortcut: 'new-chat',
      run: d.newChat,
    },
    {
      id: 'toggle-sidebar',
      label: d.t('shell.palette.commands.toggleSidebar'),
      keywords: ['sidebar', 'hide', 'show', 'bilah'],
      shortcut: 'toggle-sidebar',
      run: d.toggleSidebar,
    },
  ];
  for (const { theme, key, words } of THEMES) {
    if (theme === d.theme) continue; // Already in use: nothing to switch to.
    commands.push({
      id: `theme-${theme}`,
      label: d.t(`shell.palette.commands.${key}`),
      keywords: words,
      run: () => d.setTheme(theme),
    });
  }
  for (const section of SECTIONS) {
    const name = d.t(`settings.sections.${section}`);
    commands.push({
      id: `settings-${section}`,
      label: d.t('shell.palette.commands.openSettings', { section: name }),
      keywords: ['settings', 'preferences', 'pengaturan', name],
      run: () => d.openSettings(section),
    });
  }
  return commands;
}

/** Every word of `query` appears in the text (case-insensitive). An empty query matches all. */
export function matchesQuery(query: string, ...texts: (string | null | undefined)[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = texts.join('\n').toLowerCase();
  return words.every((w) => hay.includes(w));
}

type ListData = InfiniteData<{ items: ConversationSummary[] }>;

/** The chats any loaded list holds (sidebar sections, folders), newest first, without repeats. */
export function cachedChats(qc: QueryClient): ConversationSummary[] {
  const seen = new Map<string, ConversationSummary>();
  for (const [, data] of qc.getQueriesData<ListData>({ queryKey: ['conversations'] })) {
    if (!data || !Array.isArray(data.pages)) continue;
    for (const page of data.pages) {
      for (const c of page.items) {
        if (c.deletedAt === null && !seen.has(c.id)) seen.set(c.id, c);
      }
    }
  }
  return [...seen.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}
