import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useThrottled } from './use-throttled';

afterEach(() => vi.useRealTimers());

test('passes values on at once without an interval', () => {
  const { result, rerender } = renderHook(({ v }) => useThrottled(v, 0), {
    initialProps: { v: 1 },
  });
  rerender({ v: 2 });
  expect(result.current).toBe(2);
});

test('shows at most one new value per interval, and always the latest in the end', () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(({ v }) => useThrottled(v, 500), {
    initialProps: { v: 1 },
  });
  rerender({ v: 2 });
  rerender({ v: 3 });
  expect(result.current).toBe(1);
  act(() => vi.advanceTimersByTime(499));
  expect(result.current).toBe(1);
  act(() => vi.advanceTimersByTime(1));
  expect(result.current).toBe(3);
  // After a quiet spell longer than the interval, a change shows at once.
  act(() => vi.advanceTimersByTime(600));
  rerender({ v: 4 });
  expect(result.current).toBe(4);
});

test('a value waiting when the interval drops to 0 shows at once', () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(({ v, i }) => useThrottled(v, i), {
    initialProps: { v: 1, i: 500 },
  });
  rerender({ v: 2, i: 500 });
  expect(result.current).toBe(1);
  rerender({ v: 2, i: 0 });
  expect(result.current).toBe(2);
  act(() => vi.advanceTimersByTime(500));
  expect(result.current).toBe(2);
});
