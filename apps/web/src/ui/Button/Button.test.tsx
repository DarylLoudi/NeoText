import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Button } from '@/ui';

test('loading button is disabled and busy', () => {
  render(<Button loading>Save changes</Button>);
  const b = screen.getByRole('button', { name: 'Save changes' });
  expect(b).toBeDisabled();
  expect(b).toHaveAttribute('aria-busy', 'true');
});

test('defaults to a secondary button of type button', () => {
  render(<Button>Cancel</Button>);
  const b = screen.getByRole('button', { name: 'Cancel' });
  expect(b).toHaveAttribute('type', 'button');
  expect(b).not.toHaveAttribute('aria-busy');
});
