import type { ModelInfo, ModelRef } from '@neotext/shared';
import { CaretDown } from '@phosphor-icons/react';
import { Popover } from 'radix-ui';
import { type ButtonHTMLAttributes, type ReactElement, useCallback, useState } from 'react';
import { useT } from '../../../lib/i18n';
import { ModelList } from './ModelList';
import styles from './ModelPicker.module.css';
import { warmProvider } from './warm';

export interface ModelPickerProps {
  /** The model in use, highlighted when the list opens and warmed on open. */
  value: ModelRef | null;
  onChange: (ref: ModelRef) => void;
  /** The element that opens the picker. */
  children: ReactElement;
  side?: 'top' | 'bottom';
  align?: 'start' | 'end';
}

/**
 * A searchable list of every model, favorites first, then one section per provider. It reads
 * the catalog only while open, so a trigger placed on every message costs nothing.
 */
export function ModelPicker({
  value,
  onChange,
  children,
  side = 'bottom',
  align = 'start',
}: ModelPickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      // The next message is likely to go to this provider: open its connection now.
      if (next && value) warmProvider(value.providerId);
    },
    [value],
  );
  const pick = useCallback(
    (ref: ModelRef) => {
      onChange(ref);
      warmProvider(ref.providerId);
      setOpen(false);
    },
    [onChange],
  );
  const leave = useCallback(() => setOpen(false), []);

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={styles.content}
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          aria-label={t('chat.chooseModel')}
        >
          <ModelList value={value} onPick={pick} onLeave={leave} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export type ModelButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  model: ModelInfo | null;
};

/** The top bar's trigger: the model's name and a caret. Takes the props a popover trigger adds. */
export function ModelButton({ model, ...rest }: ModelButtonProps) {
  const t = useT();
  return (
    <button {...rest} type="button" className={styles.trigger}>
      <span className={styles.triggerName} dir="auto">
        {model?.name ?? t('chat.chooseModel')}
      </span>
      <CaretDown aria-hidden />
    </button>
  );
}
