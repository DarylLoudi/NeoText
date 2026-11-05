import { CaretDown, Check } from '@phosphor-icons/react';
import { Select as S } from 'radix-ui';
import { useId } from 'react';
import styles from './Select.module.css';

export type SelectOption = { value: string; label: string; hint?: string };

export type SelectProps = {
  label?: string;
  /** Accessible name when no visible label is shown. */
  'aria-label'?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  /** Extra class for the trigger, to restyle it in place (a quieter control in a toolbar). */
  triggerClassName?: string;
  /** Muted words before the chosen value, such as the name of the setting. */
  triggerPrefix?: string;
};

export function Select({
  label,
  value,
  onChange,
  options,
  disabled,
  triggerClassName,
  triggerPrefix,
  ...rest
}: SelectProps) {
  const id = useId();
  return (
    <div className={styles.field}>
      {label ? (
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
      ) : null}
      <S.Root value={value} onValueChange={onChange} disabled={disabled}>
        <S.Trigger
          id={id}
          className={triggerClassName ? `${styles.trigger} ${triggerClassName}` : styles.trigger}
          aria-label={rest['aria-label']}
        >
          {triggerPrefix ? <span className={styles.prefix}>{triggerPrefix}</span> : null}
          <S.Value />
          <S.Icon className={styles.caret}>
            <CaretDown aria-hidden />
          </S.Icon>
        </S.Trigger>
        <S.Portal>
          <S.Content className={styles.content} position="popper" sideOffset={4}>
            <S.Viewport className={styles.viewport}>
              {options.map((o) => (
                <S.Item key={o.value} value={o.value} className={styles.item}>
                  <span className={styles.itemText}>
                    <S.ItemText>{o.label}</S.ItemText>
                    {o.hint ? <span className={styles.itemHint}>{o.hint}</span> : null}
                  </span>
                  <S.ItemIndicator className={styles.check}>
                    <Check aria-hidden />
                  </S.ItemIndicator>
                </S.Item>
              ))}
            </S.Viewport>
          </S.Content>
        </S.Portal>
      </S.Root>
    </div>
  );
}
