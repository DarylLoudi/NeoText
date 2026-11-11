import { X } from '@phosphor-icons/react';
import * as D from 'radix-ui/dialog';
import type { ReactNode, RefObject } from 'react';
import { useT } from '../../lib/i18n';
import styles from './Dialog.module.css';

export type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Accessible name of the close button. */
  closeLabel?: string;
  /** Takes focus when the dialog opens, instead of its first focusable element. */
  initialFocus?: RefObject<HTMLElement | null>;
};

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeLabel,
  initialFocus,
}: DialogProps) {
  const t = useT();
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={styles.overlay} />
        <D.Content
          className={`${styles.content} ${styles[size]}`}
          onOpenAutoFocus={(e) => {
            if (!initialFocus?.current) return;
            e.preventDefault();
            initialFocus.current.focus();
          }}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <header className={styles.header}>
            <D.Title className={styles.title}>{title}</D.Title>
            <D.Close className={styles.close} aria-label={closeLabel ?? t('common.close')}>
              <X aria-hidden />
            </D.Close>
          </header>
          {description ? (
            <D.Description className={styles.description}>{description}</D.Description>
          ) : null}
          <div className={styles.body}>{children}</div>
          {footer ? <footer className={styles.footer}>{footer}</footer> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
