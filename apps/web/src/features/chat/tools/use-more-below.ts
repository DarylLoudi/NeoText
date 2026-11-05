import { type RefObject, useLayoutEffect, useState } from 'react';

/** Rounded layout sizes can leave a pixel or so at the very end. */
const END_SLACK_PX = 1;

/**
 * Whether a scrolling box has more below what shows. It follows the scroll position and the
 * box's size; `content` is what the box holds, so new content is measured as well.
 */
export function useMoreBelow(ref: RefObject<HTMLElement | null>, content: unknown): boolean {
  const [more, setMore] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: content is why it measures again
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const measure = () =>
      setMore(box.scrollHeight - box.clientHeight - box.scrollTop > END_SLACK_PX);
    measure();
    box.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(box);
    return () => {
      box.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [ref, content]);
  return more;
}
