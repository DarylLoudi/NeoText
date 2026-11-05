import {
  forwardRef,
  type TextareaHTMLAttributes,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
} from 'react';
import styles from './TextArea.module.css';

export type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'rows'> & {
  id?: string;
  label: string;
  hint?: string;
  error?: string;
  minRows?: number;
  maxRows?: number;
  /** Keeps the label for assistive technology only, when the surrounding design names the field. */
  hideLabel?: boolean;
};

const px = (v: string) => Number.parseFloat(v) || 0;

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  {
    label,
    hint,
    error,
    id,
    minRows = 2,
    maxRows = 8,
    hideLabel = false,
    className,
    onInput,
    value,
    ...rest
  },
  forwarded,
) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [errorId, hintId, rest['aria-describedby']].filter(Boolean).join(' ');
  const inner = useRef<HTMLTextAreaElement | null>(null);

  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      inner.current = el;
      if (typeof forwarded === 'function') forwarded(el);
      else if (forwarded) forwarded.current = el;
    },
    [forwarded],
  );

  const resize = useCallback(() => {
    const el = inner.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const lineHeight = px(cs.lineHeight) || px(cs.fontSize) * 1.5 || 20;
    const border = px(cs.borderTopWidth) + px(cs.borderBottomWidth);
    const chrome = px(cs.paddingTop) + px(cs.paddingBottom) + border;
    const min = lineHeight * minRows + chrome;
    const max = lineHeight * maxRows + chrome;
    el.style.height = 'auto';
    const wanted = Math.max(min, el.scrollHeight + border);
    el.style.height = `${Math.min(wanted, max)}px`;
    el.style.overflowY = wanted > max ? 'auto' : 'hidden';
  }, [minRows, maxRows]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when a controlled value changes
  useLayoutEffect(resize, [resize, value]);

  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label
        className={hideLabel ? `${styles.label} ${styles.hiddenLabel}` : styles.label}
        htmlFor={inputId}
      >
        {label}
      </label>
      <textarea
        {...rest}
        ref={setRef}
        id={inputId}
        value={value}
        rows={minRows}
        className={styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        onInput={(e) => {
          resize();
          onInput?.(e);
        }}
      />
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
});
