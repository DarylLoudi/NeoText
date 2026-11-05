import type { ModelInfo } from '@neotext/shared';
import type { ReactNode } from 'react';
import { useT } from '../../../lib/i18n';
import { Button } from '../../../ui';
import { CompareToggle } from '../../compare/CompareToggle';
import styles from './ComposerToolbar.module.css';
import { type EffortChoice, ReasoningSelect } from './ReasoningSelect';
import { type WebSearchChoice, WebSearchToggle } from './WebSearchToggle';

export interface ComposerToolbarProps {
  model: ModelInfo | null;
  effort: EffortChoice;
  onEffort: (effort: EffortChoice) => void;
  webSearch: WebSearchChoice;
  /** Whether the next message goes to several models side by side. */
  compare: boolean;
  onCompare: () => void;
  hint: string;
  generating: boolean;
  canSend: boolean;
  onStop: () => void;
  /** The attach button, first in the row. */
  attach?: ReactNode;
}

/**
 * Under the text: web search (when something can search), compare, the reasoning choice, the
 * key hint, and one button that sends or stops.
 */
export function ComposerToolbar({
  model,
  effort,
  onEffort,
  webSearch,
  compare,
  onCompare,
  hint,
  generating,
  canSend,
  onStop,
  attach,
}: ComposerToolbarProps) {
  const t = useT();
  return (
    <div className={styles.toolbar}>
      {attach}
      {webSearch.available ? (
        <WebSearchToggle on={webSearch.on} native={webSearch.native} onToggle={webSearch.toggle} />
      ) : null}
      <CompareToggle on={compare} onToggle={onCompare} />
      <ReasoningSelect reasoning={model?.reasoning ?? null} value={effort} onChange={onEffort} />
      <p className={styles.hint}>{hint}</p>
      {generating ? (
        <Button
          variant="primary"
          className={styles.action}
          aria-label={t('chat.stop')}
          onClick={onStop}
        >
          {t('chat.composer.stop')}
        </Button>
      ) : (
        <Button
          type="submit"
          variant="primary"
          className={styles.action}
          aria-label={t('chat.send')}
          disabled={!canSend}
        >
          {t('chat.composer.send')}
        </Button>
      )}
    </div>
  );
}
