import type { ModelInfo } from '@neotext/shared';
import { ArrowUp, Stop } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useT } from '../../../lib/i18n';
import { IconButton } from '../../../ui';
import { CompareToggle } from '../../compare/CompareToggle';
import styles from './ComposerToolbar.module.css';
import { type EffortChoice, ReasoningSelect } from './ReasoningSelect';

export interface ComposerToolbarProps {
  model: ModelInfo | null;
  effort: EffortChoice;
  onEffort: (effort: EffortChoice) => void;
  /** Whether the next message goes to several models side by side. */
  compare: boolean;
  onCompare: () => void;
  generating: boolean;
  canSend: boolean;
  /** Whether Enter itself sends (else Ctrl or Cmd with Enter): only the send button's hint. */
  enterSends?: boolean;
  onStop: () => void;
  /** The attach button, first in the row. */
  attach?: ReactNode;
  /** The agent button, after attach. */
  agent?: ReactNode;
  /** Why compare is off and cannot be turned on, if it cannot. */
  compareBlockedBy?: string | null;
}

/**
 * Under the text: attach, agent, compare, the reasoning choice, and one round button that sends or stops.
 */
export function ComposerToolbar({
  model,
  effort,
  onEffort,
  compare,
  onCompare,
  generating,
  canSend,
  enterSends = true,
  onStop,
  attach,
  agent,
  compareBlockedBy = null,
}: ComposerToolbarProps) {
  const t = useT();
  return (
    <div className={styles.toolbar}>
      {attach}
      {agent}
      <CompareToggle on={compare} onToggle={onCompare} blockedBy={compareBlockedBy} />
      <ReasoningSelect reasoning={model?.reasoning ?? null} value={effort} onChange={onEffort} />
      {generating ? (
        <IconButton
          className={styles.action}
          label={t('chat.stop')}
          icon={<Stop weight="fill" />}
          onClick={onStop}
        />
      ) : (
        <IconButton
          type="submit"
          className={styles.action}
          label={t('chat.send')}
          icon={<ArrowUp weight="bold" />}
          title={enterSends ? t('chat.sendHintEnter') : t('chat.sendHintMod')}
          disabled={!canSend}
        />
      )}
    </div>
  );
}
