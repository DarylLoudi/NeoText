import type { MessagePublic } from '@neotext/shared';
import { type CSSProperties, useRef, useState } from 'react';
import { formatCost, formatDuration } from '../../lib/format';
import { getLocale, useT } from '../../lib/i18n';
import { useGenerations } from '../../state/generations';
import { Button } from '../../ui';
import { noteKey } from '../chat/AssistantMessage';
import { Caret } from '../chat/Caret';
import type { CodeTheme } from '../chat/markdown/highlight';
import { PartRenderer } from '../chat/PartRenderer';
import { stopGeneration } from '../chat/streaming/stream-client';
import { shortModelName } from '../chat/thread';
import { useSwitchLeaf } from '../chat/use-switch-leaf';
import styles from './CompareColumns.module.css';
import { chooseAnswer, showComparison } from './compare-state';

export interface CompareColumnsProps {
  conversationId: string;
  /** The answers written side by side, oldest first (2 to 4). */
  group: MessagePublic[];
  /** The answer on the chat's path: the one the thread continues from until another is chosen. */
  activeId: string;
  showCost: boolean;
  codeTheme: CodeTheme;
}

interface ColumnProps {
  conversationId: string;
  saved: MessagePublic;
  active: boolean;
  showCost: boolean;
  codeTheme: CodeTheme;
}

function Column({ conversationId, saved, active, showCost, codeTheme }: ColumnProps) {
  const t = useT();
  const locale = getLocale();
  const live = useGenerations((s) => s.byMessage[saved.id]);
  const switchLeaf = useSwitchLeaf(conversationId);
  const bodyRef = useRef<HTMLDivElement>(null);
  const message = live?.message ?? saved;
  const lost = live?.lost ?? false;
  const streaming = message.status === 'streaming' && !lost;
  const note = noteKey(message, live?.reconnecting ?? false, lost);
  const [choosing, setChoosing] = useState(false);
  const name = message.model ? shortModelName(message.model.modelId) : t('chat.assistant');
  const { usage } = message;
  const cost = showCost && usage ? formatCost(usage.costUsd, locale) : '';

  let liveIndex = -1;
  if (streaming) {
    liveIndex = message.parts.length - 1;
    if (message.parts[liveIndex]?.type === 'sources') liveIndex -= 1;
  }

  const stop = () => {
    // A 404 means it already ended; the stream reports how.
    if (live) stopGeneration(live.generationId).catch(() => undefined);
  };
  // Settled only once the new leaf is saved: a failed save leaves the columns as they were.
  const choose = async () => {
    setChoosing(true);
    const done = await switchLeaf(message.id);
    setChoosing(false);
    if (done && message.parentId) chooseAnswer(message.parentId);
  };

  return (
    <section className={styles.column} aria-label={name} aria-busy={streaming || undefined}>
      <header className={styles.header}>
        <span className={styles.model} title={message.model?.modelId}>
          {name}
        </span>
        {active ? <span className={styles.active}>{t('chat.compare.continuesHere')}</span> : null}
        <span className={styles.figures}>
          {usage?.durationMs != null ? (
            <span>{formatDuration(usage.durationMs, locale)}</span>
          ) : null}
          {cost ? <span>{cost}</span> : null}
        </span>
      </header>
      <div ref={bodyRef} className={styles.body}>
        {message.parts.map((part, i) => (
          <PartRenderer
            // biome-ignore lint/suspicious/noArrayIndexKey: parts only grow; earlier ones keep their place
            key={i}
            part={part}
            message={message}
            live={i === liveIndex}
            codeTheme={codeTheme}
          />
        ))}
      </div>
      {streaming ? <Caret targetRef={bodyRef} /> : null}
      {note ? <p className={styles.note}>{t(note)}</p> : null}
      <div className={styles.actions}>
        {streaming ? (
          <Button size="sm" aria-label={t('chat.compare.stopOne')} onClick={stop}>
            {t('chat.composer.stop')}
          </Button>
        ) : (
          <Button size="sm" loading={choosing} onClick={() => void choose()}>
            {t('chat.compare.continue')}
          </Button>
        )}
      </div>
    </section>
  );
}

/**
 * One turn's answers side by side over the full width of the chat, each with its own stop and
 * "Continue with this answer". Below 900 px the columns stack.
 */
export function CompareColumns({
  conversationId,
  group,
  activeId,
  showCost,
  codeTheme,
}: CompareColumnsProps) {
  const t = useT();
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would bring a legend and a border
    <div
      className={styles.columns}
      style={{ '--columns': group.length } as CSSProperties}
      role="group"
      aria-label={t('chat.compare.region', { count: group.length })}
    >
      {group.map((m) => (
        <Column
          key={m.id}
          conversationId={conversationId}
          saved={m}
          active={m.id === activeId}
          showCost={showCost}
          codeTheme={codeTheme}
        />
      ))}
    </div>
  );
}

/** Under an answer settled from a comparison: brings the columns back. */
export function ShowComparison({ userMessageId }: { userMessageId: string }) {
  const t = useT();
  return (
    <div className={styles.show}>
      <Button size="sm" onClick={() => showComparison(userMessageId)}>
        {t('chat.compare.show')}
      </Button>
    </div>
  );
}
