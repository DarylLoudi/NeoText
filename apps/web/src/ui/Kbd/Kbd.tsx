import type { ReactNode } from 'react';
import styles from './Kbd.module.css';

/** `hint` marks a shortcut reminder next to a control; touch screens without a keyboard hide it. */
export function Kbd({ children, hint = false }: { children: ReactNode; hint?: boolean }) {
  return <kbd className={hint ? `${styles.kbd} ${styles.hint}` : styles.kbd}>{children}</kbd>;
}
