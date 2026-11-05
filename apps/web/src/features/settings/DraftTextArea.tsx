import { useEffect, useRef, useState } from 'react';
import { TextArea, type TextAreaProps } from '../../ui';

export interface DraftTextAreaProps
  extends Omit<TextAreaProps, 'value' | 'onChange' | 'defaultValue'> {
  value: string;
  onCommit: (value: string) => void;
}

/** How long typing may pause before the text is saved without leaving the box. */
export const DRAFT_PAUSE_MS = 800;

/**
 * Long text saved as one change when you leave the box, pause typing, or leave the page,
 * not as a change per key.
 */
export function DraftTextArea({ value, onCommit, ...rest }: DraftTextAreaProps) {
  const [text, setText] = useState(value);
  const latest = useRef({ text, value, onCommit });
  latest.current = { text, value, onCommit };
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => setText(value), [value]);

  const flush = () => {
    clearTimeout(timer.current);
    const { text: now, value: saved, onCommit: save } = latest.current;
    if (now !== saved) save(now);
  };
  // Leaving the section with unsaved typing still saves it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: flush reads refs only
  useEffect(() => flush, []);

  return (
    <TextArea
      {...rest}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        clearTimeout(timer.current);
        timer.current = setTimeout(flush, DRAFT_PAUSE_MS);
      }}
      onBlur={flush}
    />
  );
}
