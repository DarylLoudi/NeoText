import { type RefObject, useLayoutEffect, useRef } from 'react';
import styles from './Caret.module.css';

/** The deepest last text node with visible characters, searched from the end (cheap per frame). */
function lastTextNode(node: Node): Text | null {
  for (let child = node.lastChild; child; child = child.previousSibling) {
    if (child.nodeType === Node.TEXT_NODE) {
      if ((child.textContent ?? '').trim() !== '') return child as Text;
      continue;
    }
    if (child instanceof HTMLElement && child.dataset.caret !== undefined) continue;
    if (child instanceof Element && getComputedStyle(child).display === 'none') continue;
    const found = lastTextNode(child);
    if (found) return found;
  }
  return null;
}

export interface CaretProps {
  /** The element holding the text being written; the caret is placed after its last character. */
  targetRef: RefObject<HTMLElement | null>;
}

/**
 * The marker block that breathes after the last character while an answer streams. It sits in
 * the target's positioned parent and follows the text each render; it is decoration only.
 */
export function Caret({ targetRef }: CaretProps) {
  const ref = useRef<HTMLSpanElement>(null);

  // No dependency list: the text changes on every streamed frame, and so does the position.
  useLayoutEffect(() => {
    const caret = ref.current;
    const target = targetRef.current;
    const frame = caret?.offsetParent;
    if (!caret || !target || !frame) return;
    const origin = frame.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    const text = lastTextNode(target);
    // Without visible text yet, the caret waits where the next line starts.
    let left = box.left - origin.left;
    let top = box.bottom - origin.top;
    if (text) {
      const range = document.createRange();
      // After the last visible character: a trailing newline would put the caret on a new line.
      range.setStart(text, (text.textContent ?? '').trimEnd().length);
      range.collapse(true);
      const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
      if (rect.height > 0 || rect.left !== 0) {
        left = rect.right - origin.left + 2;
        top = rect.top - origin.top + (rect.height - caret.offsetHeight) / 2;
      }
    }
    // Text inside a scrolled code block can lie past the edge; never draw outside the turn.
    left = Math.max(0, Math.min(left, frame.clientWidth - caret.offsetWidth));
    caret.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  });

  return <span ref={ref} className={styles.caret} data-caret="" aria-hidden />;
}
