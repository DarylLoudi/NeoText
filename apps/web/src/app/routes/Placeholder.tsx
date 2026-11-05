import styles from './Placeholder.module.css';

/** Stands in for a screen a later task builds. */
export function Placeholder({ title, body }: { title: string; body?: string }) {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{title}</h1>
      {body ? <p className={styles.body}>{body}</p> : null}
    </main>
  );
}
