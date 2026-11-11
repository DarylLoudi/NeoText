import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { ensurePageStrings } from '../../lib/i18n';
import { rootRoute } from './root';

// Loaded when someone opens Usage, so the chart stays out of the chat chunk.
export const usageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/usage',
  // The page's own strings load beside its code (see ensurePageStrings).
  loader: () => ensurePageStrings(),
  component: lazyRouteComponent(
    () => import('../../features/usage/UsageDashboard'),
    'UsageDashboard',
  ),
});
