import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute } from './root';

export const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: lazyRouteComponent(() => import('./auth-pages'), 'RegisterPage'),
});
