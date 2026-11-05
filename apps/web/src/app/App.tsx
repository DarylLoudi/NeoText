import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { queryClient as sharedClient } from '../lib/query';
import { ToastHost, TooltipProvider } from '../ui';
import { type AppRouter, createAppRouter, redirectOnUnauthorized } from './router';

export interface AppProps {
  router?: AppRouter;
  queryClient?: typeof sharedClient;
}

export function App({ queryClient = sharedClient, router: given }: AppProps) {
  const [router] = useState(() => given ?? createAppRouter({ queryClient }));
  useEffect(() => redirectOnUnauthorized(router, queryClient), [router, queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <ToastHost />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
