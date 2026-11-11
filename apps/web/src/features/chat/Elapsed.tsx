import { useEffect, useState } from 'react';
import { formatDuration } from '../../lib/format';

/**
 * The whole time passed since `since` ("12 s", "1 min 5 s"), updated every second, so a long
 * step does not look stuck. Nothing before the first second. Hidden from screen readers, which
 * would read a changing status out every second.
 */
export function Elapsed({ since, className }: { since: number; className?: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.floor((now - since) / 1000);
  return seconds < 1 ? null : (
    <span className={className} aria-hidden="true">
      {formatDuration(seconds * 1000)}
    </span>
  );
}
