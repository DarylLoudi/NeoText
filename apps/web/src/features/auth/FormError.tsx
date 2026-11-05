import styles from './FormError.module.css';

export function FormError({ message }: { message?: string | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" tabIndex={-1} className={styles.error}>
      {message}
    </p>
  );
}
