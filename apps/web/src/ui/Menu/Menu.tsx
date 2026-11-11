import { CaretRight } from '@phosphor-icons/react';
import * as M from 'radix-ui/dropdown-menu';
import { type ReactNode, useId } from 'react';
import styles from './Menu.module.css';

export type MenuItem =
  | {
      /** Defaults to `label`; set it when two items may share a label. */
      id?: string;
      label: string;
      /** A second, quieter line under the label. */
      hint?: string;
      icon?: ReactNode;
      onSelect: () => void;
      danger?: boolean;
      disabled?: boolean;
    }
  | { id?: string; label: string; icon?: ReactNode; items: MenuItem[]; disabled?: boolean }
  | { separator: true };

export type MenuProps = {
  trigger: ReactNode;
  items: MenuItem[];
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Return focus somewhere other than the trigger on close (e.g. an input that replaced it). */
  onCloseAutoFocus?: (event: Event) => void;
};

function itemClass(danger?: boolean): string {
  return [styles.item, danger ? styles.danger : ''].filter(Boolean).join(' ');
}

type ActionMenuItem = Extract<MenuItem, { onSelect: () => void }>;

/** One action; a hint is a quieter second line that describes the item rather than naming it. */
function ActionItem({ item, icon }: { item: ActionMenuItem; icon: ReactNode }) {
  const id = useId();
  return (
    <M.Item
      className={itemClass(item.danger)}
      disabled={item.disabled}
      onSelect={item.onSelect}
      aria-labelledby={item.hint ? `${id}-label` : undefined}
      aria-describedby={item.hint ? `${id}-hint` : undefined}
    >
      {icon}
      {item.hint ? (
        <span className={styles.text}>
          <span id={`${id}-label`}>{item.label}</span>
          <span id={`${id}-hint`} className={styles.hint} dir="auto">
            {item.hint}
          </span>
        </span>
      ) : (
        item.label
      )}
    </M.Item>
  );
}

function Items({ items }: { items: MenuItem[] }) {
  return items.map((item, i) => {
    if ('separator' in item) {
      // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
      return <M.Separator key={`sep-${i}`} className={styles.separator} />;
    }
    const icon = item.icon ? <span className={styles.icon}>{item.icon}</span> : null;
    if ('items' in item) {
      return (
        <M.Sub key={item.id ?? item.label}>
          <M.SubTrigger className={itemClass()} disabled={item.disabled}>
            {icon}
            {item.label}
            <CaretRight className={styles.subCaret} aria-hidden />
          </M.SubTrigger>
          <M.Portal>
            <M.SubContent className={styles.content} sideOffset={4} collisionPadding={8}>
              <Items items={item.items} />
            </M.SubContent>
          </M.Portal>
        </M.Sub>
      );
    }
    return <ActionItem key={item.id ?? item.label} item={item} icon={icon} />;
  });
}

export function Menu({ trigger, items, align = 'start', side, onCloseAutoFocus }: MenuProps) {
  return (
    <M.Root>
      <M.Trigger asChild>{trigger}</M.Trigger>
      <M.Portal>
        <M.Content
          className={styles.content}
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={8}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <Items items={items} />
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
