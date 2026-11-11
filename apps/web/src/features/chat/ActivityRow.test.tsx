import { act, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { ActivityRow } from './ActivityRow';

test('says what the answer is doing while it streams', () => {
  const { rerender, container } = render(
    <ActivityRow activity="searching" streaming searches={0} />,
  );
  expect(screen.getByRole('status')).toHaveTextContent('Searching the web…');
  rerender(<ActivityRow activity="processing" streaming searches={0} />);
  expect(screen.getByRole('status')).toHaveTextContent('Working…');
  rerender(<ActivityRow activity="idle" streaming searches={2} />);
  expect(container).toBeEmptyDOMElement();
});

test('after it finishes, one line counts the searches', () => {
  const { rerender, container } = render(
    <ActivityRow activity="idle" streaming={false} searches={3} />,
  );
  expect(screen.getByText('Searched the web 3 times')).toBeInTheDocument();
  rerender(<ActivityRow activity="idle" streaming={false} searches={1} />);
  expect(screen.getByText('Searched the web once')).toBeInTheDocument();
  rerender(<ActivityRow activity="idle" streaming={false} searches={0} />);
  expect(container).toBeEmptyDOMElement();
});

test('counts the seconds while it works, from the start of each activity', () => {
  vi.useFakeTimers();
  try {
    // The message keys the row by its activity, so a new one mounts afresh.
    const row = (activity: 'processing' | 'searching') => (
      <ActivityRow key={activity} activity={activity} streaming searches={0} />
    );
    const { rerender } = render(row('processing'));
    // The first second shows no count.
    expect(screen.getByRole('status')).toHaveTextContent(/^Working…$/);
    act(() => vi.advanceTimersByTime(12_000));
    // Shown, but kept from screen readers, which would read it out every second.
    expect(screen.getByText('12 s')).toHaveAttribute('aria-hidden', 'true');
    rerender(row('searching'));
    expect(screen.queryByText('12 s')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(65_000));
    expect(screen.getByText('1 min 5 s')).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});
