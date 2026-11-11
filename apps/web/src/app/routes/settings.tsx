import { createRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { ensurePageStrings } from '../../lib/i18n';
import { rootRoute } from './root';

export const settingsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  beforeLoad: () => {
    throw redirect({ to: '/settings/$section', params: { section: 'general' } });
  },
});

// Loaded when someone opens Settings, so its code stays out of the chat chunk.
export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/$section',
  // The page's own strings load beside its code (see ensurePageStrings).
  loader: () => ensurePageStrings(),
  component: lazyRouteComponent(
    () => import('../../features/settings/SettingsPage'),
    'SettingsPage',
  ),
});
