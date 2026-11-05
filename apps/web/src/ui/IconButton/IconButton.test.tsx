import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, test } from 'vitest';
import { IconButton, TooltipProvider } from '@/ui';

const wrapper = ({ children }: { children: ReactNode }) => (
  <TooltipProvider>{children}</TooltipProvider>
);

test('icon button has an accessible name', () => {
  render(<IconButton label="Delete chat" icon={<span />} />, { wrapper });
  expect(screen.getByRole('button', { name: 'Delete chat' })).toBeInTheDocument();
});

test('pressed state is exposed', () => {
  render(<IconButton label="Pin" icon={<span />} pressed />, { wrapper });
  expect(screen.getByRole('button', { name: 'Pin' })).toHaveAttribute('aria-pressed', 'true');
});
