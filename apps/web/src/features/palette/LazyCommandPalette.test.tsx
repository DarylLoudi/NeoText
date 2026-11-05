import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { dismissToast, ToastHost } from '../../ui';
import { getToasts } from '../../ui/Toast/toastStore';
import { LazyCommandPalette } from './LazyCommandPalette';

const chunk = vi.hoisted(() => ({ fails: true }));

// Stands in for a code chunk that cannot be fetched (offline, or a deploy replaced the file).
vi.mock('./CommandPalette', () => ({
  get CommandPalette() {
    if (chunk.fails) throw new Error('Failed to fetch dynamically imported module');
    return () => <div role="dialog" aria-label="Command palette" />;
  },
}));

beforeEach(() => {
  chunk.fails = true;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const t of getToasts()) dismissToast(t.id);
});

function renderWithUser(ui: React.ReactElement) {
  const user = userEvent.setup();
  return { user, ...render(ui) };
}

test('a chunk that fails to load shows a notice and closes, without breaking the page', async () => {
  const onOpenChange = vi.fn();
  render(
    <>
      <p>The rest of the app</p>
      <LazyCommandPalette open onOpenChange={onOpenChange} />
      <ToastHost />
    </>,
  );
  expect(await screen.findByText('Couldn’t open the palette. Try again.')).toBeInTheDocument();
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(screen.getByText('The rest of the app')).toBeInTheDocument();
});

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open palette
      </button>
      <LazyCommandPalette open={open} onOpenChange={setOpen} />
      <ToastHost />
    </>
  );
}

test('opening it again tries the load again', async () => {
  const { user } = renderWithUser(<Harness />);
  await screen.findByText('Couldn’t open the palette. Try again.');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  chunk.fails = false;
  await user.click(screen.getByRole('button', { name: 'Open palette' }));
  expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
});
