import { useEffect, useRef, useState } from 'react';

/** `value`, updated at most every `interval` ms (at once when `interval` is 0). */
export function useThrottled<T>(value: T, interval: number): T {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    const wait = interval - (Date.now() - last.current);
    if (interval === 0 || wait <= 0) {
      last.current = Date.now();
      setShown(value);
      return;
    }
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      last.current = Date.now();
      setShown(latest.current);
    }, wait);
  }, [value, interval]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return shown;
}
