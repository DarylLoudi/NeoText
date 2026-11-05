import { useRouterState } from '@tanstack/react-router';
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useAppCommand } from '../../lib/app-commands';
import { setLocale } from '../../lib/i18n';
import { useMediaQuery } from '../../lib/use-media-query';
import { updateSettings, useSettings } from '../../state/settings';
import { useToolsFollowSettings } from '../settings/use-tools-follow-settings';
import { Sidebar } from '../sidebar/Sidebar';
import { SidebarCustomizer } from '../sidebar/SidebarCustomizer';
import { SidebarResizer } from '../sidebar/SidebarResizer';
import { useBudgetAlerts } from '../usage/use-budget-alerts';
import styles from './AppShell.module.css';
import { SettingsBanner } from './SettingsBanner';
import { TopBar, TopBarSlotsProvider } from './TopBar';

/** Below this width the sidebar becomes a drawer over the page. */
const NARROW = '(max-width: 767px)';
const SIDEBAR_ID = 'app-sidebar';

export interface AppShellProps {
  children: ReactNode;
  onSearch?: () => void;
  onCustomize?: () => void;
}

export function AppShell({ children, onSearch, onCustomize }: AppShellProps) {
  useToolsFollowSettings();
  useBudgetAlerts();
  const { width, position, collapsed } = useSettings((s) => s.settings.sidebar);
  const locale = useSettings((s) => s.settings.locale);
  const narrow = useMediaQuery(NARROW);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const sidebarRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Back to where the drawer was opened from, once the page is no longer inert.
  useEffect(() => {
    if (drawerOpen || !returnFocus.current) return;
    if (returnFocus.current.isConnected) returnFocus.current.focus();
    returnFocus.current = null;
  }, [drawerOpen]);

  useEffect(() => setLocale(locale), [locale]);

  // Choosing a chat (or any navigation) closes the drawer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on path change only
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!narrow) setDrawerOpen(false);
  }, [narrow]);

  useEffect(() => {
    // While the customize dialog is open, Escape belongs to it.
    if (!drawerOpen || customizing) return;
    // A link first: focusing an icon button would open its tooltip, and Escape would close that.
    const el = sidebarRef.current;
    (
      el?.querySelector<HTMLElement>('a[href]') ?? el?.querySelector<HTMLElement>('button')
    )?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) closeDrawer();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen, customizing, closeDrawer]);

  const sidebarOpen = narrow ? drawerOpen : !collapsed;
  const toggle = () => {
    if (narrow) {
      if (drawerOpen) closeDrawer();
      else {
        returnFocus.current = document.activeElement as HTMLElement | null;
        setDrawerOpen(true);
      }
      return;
    }
    updateSettings({ sidebar: { collapsed: !collapsed } });
  };

  useAppCommand('toggle-sidebar', toggle);

  const commitWidth = (next: number) => {
    setLiveWidth(null);
    if (next !== width) updateSettings({ sidebar: { width: next } });
  };

  const shownWidth = liveWidth ?? width;
  return (
    <div
      className={styles.shell}
      data-sidebar-position={position}
      data-sidebar-collapsed={String(collapsed)}
      data-narrow={narrow || undefined}
      data-drawer={narrow ? (drawerOpen ? 'open' : 'closed') : undefined}
      style={{ '--sidebar-width': `${shownWidth}px` } as CSSProperties}
    >
      <div
        ref={sidebarRef}
        id={SIDEBAR_ID}
        className={styles.sidebar}
        hidden={!narrow && collapsed}
        inert={narrow && !drawerOpen}
      >
        <Sidebar
          onSearch={onSearch}
          onCustomize={() => {
            setCustomizing(true);
            onCustomize?.();
          }}
          onClose={narrow ? closeDrawer : undefined}
        />
        {narrow ? null : (
          <SidebarResizer
            width={shownWidth}
            side={position}
            onResize={setLiveWidth}
            onCommit={commitWidth}
          />
        )}
      </div>
      {narrow && drawerOpen ? (
        // A pointer shortcut only (hidden from assistive tech); Escape and the close button do the same.
        <div className={styles.scrim} onClick={closeDrawer} aria-hidden />
      ) : null}
      <TopBarSlotsProvider>
        {/* While the drawer is open the page behind it is out of reach, so Tab stays inside. */}
        <div className={styles.main} inert={narrow && drawerOpen}>
          <TopBar sidebarOpen={sidebarOpen} onToggleSidebar={toggle} sidebarId={SIDEBAR_ID} />
          <SettingsBanner />
          <div className={styles.content}>{children}</div>
        </div>
      </TopBarSlotsProvider>
      <SidebarCustomizer open={customizing} onOpenChange={setCustomizing} />
    </div>
  );
}
