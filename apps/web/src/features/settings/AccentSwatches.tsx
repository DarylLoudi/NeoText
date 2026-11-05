import { useId } from 'react';
import { useT } from '../../lib/i18n';
import styles from './AccentSwatches.module.css';

export const ACCENTS = ['marker', 'mint', 'sky', 'rose', 'graphite'] as const;
export type Accent = (typeof ACCENTS)[number];

export interface AccentSwatchesProps {
  value: Accent;
  onChange: (accent: Accent) => void;
}

/** Native radios drawn as color chips, so arrow keys and screen readers work as for any radio. */
export function AccentSwatches({ value, onChange }: AccentSwatchesProps) {
  const t = useT();
  const name = useId();
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{t('settings.appearance.accent')}</legend>
      <div className={styles.options}>
        {ACCENTS.map((accent) => (
          <label key={accent} className={styles.option}>
            <input
              className={styles.input}
              type="radio"
              name={name}
              value={accent}
              checked={value === accent}
              onChange={() => onChange(accent)}
            />
            <span className={styles.chip} data-accent={accent} aria-hidden />
            <span className={styles.text}>{t(`settings.appearance.accents.${accent}`)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
