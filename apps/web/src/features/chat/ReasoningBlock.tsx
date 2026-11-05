import type { MessagePart } from '@neotext/shared';
import { CaretRight } from '@phosphor-icons/react';
import { formatDuration } from '../../lib/format';
import { useT } from '../../lib/i18n';
import styles from './ReasoningBlock.module.css';

export interface ReasoningBlockProps {
  part: Extract<MessagePart, { type: 'reasoning' }>;
  /** True while this reasoning is still arriving. */
  live: boolean;
}

/** The model's thinking: the live tail while it streams, then a closed disclosure. */
export function ReasoningBlock({ part, live }: ReasoningBlockProps) {
  const t = useT();
  if (live) {
    return (
      <div className={styles.block}>
        <p className={styles.label}>{t('chat.reasoning.live')}</p>
        <div className={styles.live}>
          <p className={styles.text} dir="auto">
            {part.text}
          </p>
        </div>
      </div>
    );
  }
  const label =
    part.durationMs === null
      ? t('chat.reasoning.stopped')
      : t('chat.reasoning.done', { duration: formatDuration(part.durationMs) });
  return (
    <details className={styles.block}>
      <summary className={styles.summary}>
        <CaretRight className={styles.chevron} aria-hidden />
        {label}
      </summary>
      <p className={styles.text} dir="auto">
        {part.text}
      </p>
    </details>
  );
}
