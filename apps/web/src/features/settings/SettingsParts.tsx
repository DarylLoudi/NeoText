import { type ReactNode, useId } from 'react';
import styles from './SettingsParts.module.css';

/** The page's h1 and one line of what the page is for. */
export function SectionHeader({ title, intro }: { title: string; intro?: string }) {
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{title}</h1>
      {intro ? <p className={styles.intro}>{intro}</p> : null}
    </header>
  );
}

/** A titled run of related controls, set off from the next by a rule; its title names it. */
export function Group({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section className={styles.group} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.groupTitle}>
        {title}
      </h2>
      {intro ? <p className={styles.groupIntro}>{intro}</p> : null}
      <div className={styles.controls}>{children}</div>
    </section>
  );
}

/** Controls that sit side by side while they fit, then stack. */
export function Row({ children }: { children: ReactNode }) {
  return <div className={styles.row}>{children}</div>;
}
