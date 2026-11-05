import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute } from './root';

// Loaded when someone opens Usage, so the chart stays out of the chat chunk.
export const usageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/usage',
  component: lazyRouteComponent(
    () => import('../../features/usage/UsageDashboard'),
    'UsageDashboard',
  ),
});
