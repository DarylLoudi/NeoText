import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { useT } from '../../lib/i18n';
import { IconButton } from '../../ui';
import styles from './BranchSwitcher.module.css';
import { useSwitchLeaf } from './use-switch-leaf';

export interface BranchSwitcherProps {
  conversationId: string;
  /** The versions of this turn, oldest first. */
  siblingIds: string[];
  index: number;
  disabled?: boolean;
}

/** "‹ 2 / 3 ›": moves the chat to another version of a turn, and to that version's newest leaf. */
export function BranchSwitcher({
  conversationId,
  siblingIds,
  index,
  disabled,
}: BranchSwitcherProps) {
  const t = useT();
  const switchLeaf = useSwitchLeaf(conversationId);

  const go = async (to: number) => {
    const siblingId = siblingIds[to];
    if (siblingId) await switchLeaf(siblingId);
  };

  const count = siblingIds.length;
  const position = t('chat.branch.position', { index: index + 1, count });
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would bring a legend and a border
    <div className={styles.switcher} role="group" aria-label={position}>
      <IconButton
        size="sm"
        label={t('chat.branch.previous')}
        icon={<CaretLeft />}
        disabled={disabled || index <= 0}
        onClick={() => void go(index - 1)}
      />
      <span className={styles.count} aria-hidden>
        {index + 1} / {count}
      </span>
      <IconButton
        size="sm"
        label={t('chat.branch.next')}
        icon={<CaretRight />}
        disabled={disabled || index >= count - 1}
        onClick={() => void go(index + 1)}
      />
    </div>
  );
}
