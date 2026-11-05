import { useId } from 'react';
import styles from './ChoiceGroup.module.css';

export interface ChoiceGroupProps<V extends string> {
  legend: string;
  value: V;
  onChange: (value: V) => void;
  options: { value: V; label: string }[];
}

/** A few mutually exclusive choices, side by side. Native radios, so arrow keys just work. */
export function ChoiceGroup<V extends string>({
  legend,
  value,
  onChange,
  options,
}: ChoiceGroupProps<V>) {
  const name = useId();
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.options}>
        {options.map((o) => (
          <label key={o.value} className={styles.option}>
            <input
              className={styles.input}
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span className={styles.text}>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
