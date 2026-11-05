import { ChartBar, Columns, MagnifyingGlass, NotePencil, X } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ariaKeyShortcuts, formatCombo, IS_MAC, resolveShortcuts } from '../../lib/hotkeys';
import { useT } from '../../lib/i18n';
import { useSettings } from '../../state/settings';
import { IconButton, Kbd } from '../../ui';
import { toggleCompare, useCompare } from '../compare/compare-state';
import { setPendingPreset } from '../presets/use-presets';
import { SidebarScroll } from './ConversationList';
import { PresetsQuickAction } from './PresetsQuickAction';
import styles from './Sidebar.module.css';
import { SidebarFooter } from './SidebarFooter';
import { SidebarSection } from './SidebarSection';
import { SidebarDnd } from './sidebar-dnd';

export interface SidebarProps {
  /** Opens conversation search. Without it the quick action is disabled. */
  onSearch?: () => void;
  onCustomize?: () => void;
  /** Shown as a close button when the sidebar is a drawer. */
  onClose?: () => void;
}

function QuickActions({ onSearch }: { onSearch?: () => void }) {
  const t = useT();
  const actions = useSettings((s) => s.settings.sidebar.quickActions);
  const overrides = useSettings((s) => s.settings.shortcuts);
  const combo = resolveShortcuts(overrides).search;
  const keys = formatCombo(combo, IS_MAC);
  const comparing = useCompare((s) => s.enabled);
  return (
    <div className={styles.actions}>
      {actions.map((action) => {
        if (action === 'new-chat') {
          return (
            <Link
              key={action}
              to="/"
              className={styles.action}
              onClick={() => setPendingPreset(null)}
            >
              <NotePencil className={styles.actionIcon} aria-hidden />
              {t('sidebar.newChat')}
            </Link>
          );
        }
        if (action === 'search') {
          return (
            <button
              key={action}
              type="button"
              className={styles.action}
              onClick={onSearch}
              disabled={!onSearch}
              aria-keyshortcuts={ariaKeyShortcuts(combo, IS_MAC)}
            >
              <MagnifyingGlass className={styles.actionIcon} aria-hidden />
              {t('sidebar.search')}
              <span className={styles.shortcut}>
                {keys.map((key, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length list rebuilt as a whole
                  <Kbd key={`${i}:${key}`}>{key}</Kbd>
                ))}
              </span>
            </button>
          );
        }
        if (action === 'presets') return <PresetsQuickAction key={action} />;
        if (action === 'usage') {
          return (
            <Link key={action} to="/usage" className={styles.action}>
              <ChartBar className={styles.actionIcon} aria-hidden />
              {t('sidebar.usage')}
            </Link>
          );
        }
        if (action === 'compare') {
          return (
            <button
              key={action}
              type="button"
              className={styles.action}
              aria-pressed={comparing}
              onClick={() => toggleCompare()}
            >
              <Columns className={styles.actionIcon} aria-hidden />
              {t('chat.compare.toggle')}
            </button>
          );
        }
        return null;
      })}
    </div>
  );
}

export function Sidebar({ onSearch, onCustomize, onClose }: SidebarProps) {
  const t = useT();
  const sections = useSettings((s) => s.settings.sidebar.sections);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  return (
    <aside className={styles.sidebar} aria-label={t('sidebar.region')}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.wordmark}>
            neotext
            <span className={styles.caret} aria-hidden />
          </span>
          {onClose ? (
            <IconButton size="sm" label={t('sidebar.close')} icon={<X />} onClick={onClose} />
          ) : null}
        </div>
        <QuickActions onSearch={onSearch} />
      </header>
      <div className={styles.scroll} ref={setScroller}>
        <SidebarScroll.Provider value={scroller}>
          <nav className={styles.sections} aria-label={t('sidebar.chats')}>
            <SidebarDnd>
              {sections.map((section) => (
                <SidebarSection key={section.id} section={section} sections={sections} />
              ))}
            </SidebarDnd>
          </nav>
        </SidebarScroll.Provider>
      </div>
      <SidebarFooter onCustomize={onCustomize} />
    </aside>
  );
}
