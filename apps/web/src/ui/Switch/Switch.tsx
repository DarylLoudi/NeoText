import { Switch as S } from 'radix-ui';
import { useId } from 'react';
import styles from './Switch.module.css';

export type SwitchProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  disabled?: boolean;
  /** Keeps the label for assistive tech only, when the row around it already names the thing. */
  hideLabel?: boolean;
};

export function Switch({ label, checked, onChange, hint, disabled, hideLabel }: SwitchProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={styles.row}>
      <div className={styles.text}>
        <label className={hideLabel ? styles.hidden : styles.label} htmlFor={id}>
          {label}
        </label>
        {hint ? (
          <p id={hintId} className={styles.hint}>
            {hint}
          </p>
        ) : null}
      </div>
      <S.Root
        id={id}
        className={styles.root}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-describedby={hintId}
      >
        <S.Thumb className={styles.thumb} />
      </S.Root>
    </div>
  );
}
