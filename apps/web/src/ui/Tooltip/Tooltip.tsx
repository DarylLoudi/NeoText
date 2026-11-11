import * as T from 'radix-ui/tooltip';
import type { ReactNode } from 'react';
import styles from './Tooltip.module.css';

export type TooltipProps = {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
};

/** Mounted once at the app root so moving between tooltips skips the delay. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <T.Provider delayDuration={400} skipDelayDuration={200}>
      {children}
    </T.Provider>
  );
}

/** Needs a `TooltipProvider` above it. */
export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content className={styles.content} side={side} sideOffset={6}>
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
