import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  Link,
  Outlet,
  redirect,
  useRouter,
  useRouterState,
} from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { LazyCommandPalette } from '../../features/palette/LazyCommandPalette';
import { useAppShortcuts } from '../../features/palette/use-app-shortcuts';
import { LazySearchDialog } from '../../features/search/LazySearchDialog';
import { AppShell } from '../../features/shell/AppShell';
import { useT } from '../../lib/i18n';
import { instanceQuery, sessionQuery, signUpsOpen, useSession } from '../../state/session';
import { Button } from '../../ui';
import { resumeSession } from '../session-flow';
import styles from './root.module.css';

export interface RouterContext {
  queryClient: QueryClient;
}

const AUTH_PATHS = new Set(['/login', '/recover', '/register']);

export function isAuthPath(pathname: string): boolean {
  return AUTH_PATHS.has(pathname) || pathname === '/setup';
}

/** Setup first, then sign-in, then the app. Runs on every navigation. */
async function guard({
  context,
  location,
}: {
  context: RouterContext;
  location: { pathname: string; href: string };
}) {
  const { queryClient } = context;
  const { pathname } = location;
  const instance = await queryClient.ensureQueryData(instanceQuery);
  if (instance.setupRequired) {
    if (pathname !== '/setup') throw redirect({ to: '/setup' });
    return;
  }
  const user = await queryClient.ensureQueryData(sessionQuery);
  if (user) {
    if (isAuthPath(pathname)) throw redirect({ to: '/' });
    return;
  }
  if (pathname === '/setup') throw redirect({ to: '/login' });
  // Nothing to register for when sign-ups are closed.
  if (pathname === '/register' && !signUpsOpen(instance.registration)) {
    throw redirect({ to: '/login' });
  }
  if (!AUTH_PATHS.has(pathname)) {
    throw redirect({
      to: '/login',
      search: location.href === '/' ? {} : { redirect: location.href },
    });
  }
}

function RootLayout() {
  const session = useSession();
  const user = session.data;
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    if (user) resumeSession(user, queryClient);
  }, [user, queryClient]);
  const inApp = Boolean(user) && !isAuthPath(pathname);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const togglePalette = useCallback(() => setPaletteOpen((open) => !open), []);
  const toggleSearch = useCallback(() => setSearchOpen((open) => !open), []);
  useAppShortcuts({ enabled: inApp, togglePalette, toggleSearch });
  // Going anywhere (a shortcut, a link) closes the palette and search; leaving the app closes it too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on path change only
  useEffect(() => {
    setPaletteOpen(false);
    setSearchOpen(false);
  }, [pathname]);
  if (!inApp) return <Outlet />;
  return (
    <AppShell onSearch={openSearch}>
      <Outlet />
      <LazyCommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <LazySearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </AppShell>
  );
}

function RootError({ reset }: { reset: () => void }) {
  const t = useT();
  const router = useRouter();
  return (
    <main className={styles.notice}>
      <p role="alert">{t('common.loadFailed')}</p>
      <div>
        <Button
          variant="primary"
          onClick={() => {
            reset();
            void router.invalidate();
          }}
        >
          {t('common.retry')}
        </Button>
      </div>
    </main>
  );
}

export function NotFound() {
  const t = useT();
  return (
    <main className={styles.notice}>
      <p>{t('common.notFound')}</p>
      <Link to="/" className={styles.link}>
        {t('sidebar.newChat')}
      </Link>
    </main>
  );
}

export const rootRoute = createRootRouteWithContext<RouterContext>()({
  beforeLoad: guard,
  component: RootLayout,
  errorComponent: RootError,
  notFoundComponent: NotFound,
});
