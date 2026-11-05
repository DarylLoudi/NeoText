import { type ReactNode, useEffect, useRef } from 'react';
import styles from './StepHeading.module.css';

/** The screen's h1. Moves focus here when a step replaces the one the user was on. */
export function StepHeading({
  children,
  focusOnMount = false,
  id,
}: {
  children: ReactNode;
  focusOnMount?: boolean;
  id?: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount]);
  return (
    <h1 ref={ref} id={id} tabIndex={-1} className={styles.title}>
      {children}
    </h1>
  );
}
