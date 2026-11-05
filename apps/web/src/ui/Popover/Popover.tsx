import { Popover as P } from 'radix-ui';
import type { ReactNode } from 'react';
import styles from './Popover.module.css';

export type PopoverProps = {
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: 'top' | 'right' | 'bottom' | 'left';
};

export function Popover({ trigger, children, open, onOpenChange, side = 'bottom' }: PopoverProps) {
  return (
    <P.Root open={open} onOpenChange={onOpenChange}>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content className={styles.content} side={side} sideOffset={6} collisionPadding={8}>
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
