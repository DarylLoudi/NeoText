import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute } from './root';

export const recoverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/recover',
  component: lazyRouteComponent(() => import('./auth-pages'), 'RecoverPage'),
});
