import styles from './Spinner.module.css';

export type SpinnerProps = {
  /** Accessible name. When omitted the spinner is decorative (aria-hidden). */
  label?: string;
  size?: number;
};

export function Spinner({ label, size = 16 }: SpinnerProps) {
  const style = { width: size, height: size };
  if (!label) return <span className={styles.spinner} style={style} aria-hidden="true" />;
  return <span className={styles.spinner} style={style} role="status" aria-label={label} />;
}
