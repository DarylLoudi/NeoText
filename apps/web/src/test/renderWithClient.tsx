import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { createQueryClient } from '../lib/query';
import { ToastHost, TooltipProvider } from '../ui';

/** Renders one component with the query client, tooltips and toasts it expects around it. */
export function renderWithClient(ui: ReactElement) {
  const queryClient = createQueryClient();
  const user = userEvent.setup();
  // A wrapper, so `rerender` from the result keeps these around the new element.
  const view = render(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {children}
          <ToastHost />
        </TooltipProvider>
      </QueryClientProvider>
    ),
  });
  return { ...view, queryClient, user };
}
