import { useEffect, useRef } from 'react';
import styles from './InlineRename.module.css';

export interface InlineRenameProps {
  value: string;
  label: string;
  onSave: (value: string) => void;
  /** `byKeyboard` is false when the field lost focus (the user moved elsewhere). */
  onDone: (byKeyboard: boolean) => void;
  className?: string;
}

/** Enter or leaving the field saves a changed, non-empty value; Escape cancels. */
export function InlineRename({ value, label, onSave, onDone, className }: InlineRenameProps) {
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (save: boolean, byKeyboard: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const next = ref.current?.value.trim() ?? '';
    if (save && next && next !== value) onSave(next);
    onDone(byKeyboard);
  };
  return (
    <input
      ref={ref}
      className={className ?? styles.rename}
      aria-label={label}
      defaultValue={value}
      maxLength={200}
      dir="auto"
      onBlur={() => finish(true, false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          finish(true, true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(false, true);
        }
      }}
    />
  );
}
