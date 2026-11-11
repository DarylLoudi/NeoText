import { createRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { ensurePageStrings } from '../../lib/i18n';
import { rootRoute } from './root';

export const adminIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  beforeLoad: () => {
    throw redirect({ to: '/admin/$section', params: { section: 'users' } });
  },
});

// Loaded when an admin opens it, so its code stays out of the chat chunk.
export const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/$section',
  // The page's own strings load beside its code (see ensurePageStrings).
  loader: () => ensurePageStrings(),
  component: lazyRouteComponent(() => import('../../features/admin/AdminPage'), 'AdminPage'),
});
