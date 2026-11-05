import type { QueryClient } from '@tanstack/react-query';
import { createRouter, type RouterHistory } from '@tanstack/react-router';
import { setUnauthorizedHandler } from '../lib/api/client';
import { qk } from '../lib/query';
import { adminIndexRoute, adminRoute } from './routes/admin';
import { chatDetailRoute } from './routes/chat-detail';
import { chatNewRoute } from './routes/chat-new';
import { loginRoute } from './routes/login';
import { recoverRoute } from './routes/recover';
import { registerRoute } from './routes/register';
import { isAuthPath, rootRoute } from './routes/root';
import { settingsIndexRoute, settingsRoute } from './routes/settings';
import { setupRoute } from './routes/setup';
import { usageRoute } from './routes/usage';

const routeTree = rootRoute.addChildren([
  chatNewRoute,
  chatDetailRoute,
  settingsIndexRoute,
  settingsRoute,
  usageRoute,
  adminIndexRoute,
  adminRoute,
  setupRoute,
  loginRoute,
  recoverRoute,
  registerRoute,
]);

export function createAppRouter(opts: { queryClient: QueryClient; history?: RouterHistory }) {
  return createRouter({
    routeTree,
    context: { queryClient: opts.queryClient },
    ...(opts.history ? { history: opts.history } : {}),
    defaultPreload: 'intent',
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

/**
 * A 401 mid-session means the cookie expired. Send the user to sign in and bring them back to
 * this page. Local settings edits stay in their outbox; nothing is torn down here.
 */
export function redirectOnUnauthorized(router: AppRouter, queryClient: QueryClient): () => void {
  setUnauthorizedHandler(() => {
    queryClient.setQueryData(qk.session, null);
    const { pathname, href } = router.state.location;
    if (isAuthPath(pathname)) return;
    void router.navigate({
      to: '/login',
      search: href === '/' ? {} : { redirect: href },
    });
  });
  return () => setUnauthorizedHandler(() => {});
}
