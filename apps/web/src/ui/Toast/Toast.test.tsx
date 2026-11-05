import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { dismissToast, ToastHost, toast } from '@/ui';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

test('toast action runs and dismisses; toasts expire', () => {
  render(<ToastHost />);
  const onClick = vi.fn();
  act(() => {
    toast({ message: 'Chat deleted', action: { label: 'Undo', onClick } });
  });
  expect(screen.getByText('Chat deleted')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(onClick).toHaveBeenCalledOnce();
  expect(screen.queryByText('Chat deleted')).toBeNull();

  act(() => {
    toast({ message: 'Changes saved' });
  });
  act(() => {
    vi.advanceTimersByTime(4999);
  });
  expect(screen.getByText('Changes saved')).toBeInTheDocument();
  act(() => {
    vi.advanceTimersByTime(2);
  });
  expect(screen.queryByText('Changes saved')).toBeNull();
});

test('action toasts last 10 seconds and can be dismissed by id', () => {
  render(<ToastHost />);
  let id = '';
  act(() => {
    id = toast({ message: 'Archived', action: { label: 'Undo', onClick: () => {} } });
  });
  act(() => {
    vi.advanceTimersByTime(9999);
  });
  expect(screen.getByText('Archived')).toBeInTheDocument();
  act(() => dismissToast(id));
  expect(screen.queryByText('Archived')).toBeNull();
});

test('host is a polite live region', () => {
  render(<ToastHost />);
  expect(document.querySelector('[aria-live="polite"]')).not.toBeNull();
});

test('hover and focus pause the countdown; leaving resumes it', () => {
  render(<ToastHost />);
  act(() => {
    toast({ message: 'Paused toast' });
  });
  const el = screen.getByText('Paused toast').parentElement as HTMLElement;
  act(() => {
    vi.advanceTimersByTime(3000);
  });
  fireEvent.pointerEnter(el);
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(screen.getByText('Paused toast')).toBeInTheDocument();
  fireEvent.pointerLeave(el);
  act(() => {
    vi.advanceTimersByTime(1999);
  });
  expect(screen.getByText('Paused toast')).toBeInTheDocument();
  act(() => {
    vi.advanceTimersByTime(2);
  });
  expect(screen.queryByText('Paused toast')).toBeNull();

  act(() => {
    toast({ message: 'Focus toast', action: { label: 'Undo', onClick: () => {} } });
  });
  const undo = screen.getByRole('button', { name: 'Undo' });
  fireEvent.focus(undo);
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(screen.getByText('Focus toast')).toBeInTheDocument();
  fireEvent.blur(undo);
  act(() => {
    vi.advanceTimersByTime(10_001);
  });
  expect(screen.queryByText('Focus toast')).toBeNull();
});
