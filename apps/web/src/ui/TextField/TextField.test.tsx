import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { TextField } from '@/ui';

test('field error is linked', () => {
  render(<TextField label="Username" error="Use 3–32 letters." />);
  const input = screen.getByLabelText('Username');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAccessibleDescription('Use 3–32 letters.');
});

test('hint is linked and field is valid', () => {
  render(<TextField label="Name" hint="Shown to others." />);
  const input = screen.getByLabelText('Name');
  expect(input).not.toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAccessibleDescription('Shown to others.');
});
