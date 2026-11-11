import type { MessagePublic, Source } from '@neotext/shared';
import { lazy, memo, Suspense, useMemo, useRef } from 'react';
import { formatCost, formatDuration, formatTime } from '../../lib/format';
import { getLocale, useT } from '../../lib/i18n';
import { useGenerations } from '../../state/generations';
import { Button } from '../../ui';
import { useProjectVersion } from '../project/project-versions';
import { ActivityRow } from './ActivityRow';
import styles from './AssistantMessage.module.css';
import { Caret } from './Caret';
import { MessageActions, useChatActions } from './MessageActions';
import { MessageItem } from './MessageItem';
import type { CodeTheme } from './markdown/highlight';
import { PartRenderer } from './PartRenderer';
import { CitationCard, useCitationCard } from './sources/CitationCard';
import { citationLinks } from './sources/citations';
import { sameItem, shortModelName, type ThreadItem } from './thread';

// Loaded with the project replay, only in chats whose answers changed a project.
const ProjectChangeRow = lazy(() =>
  import('../project/ProjectChangeRow').then((m) => ({ default: m.ProjectChangeRow })),
);

export interface AssistantMessageProps {
  item: ThreadItem;
  showCost: boolean;
  reconnecting: boolean;
  /** Reconnecting gave up: the text so far stays, and nothing more arrives on this page. */
  lost?: boolean;
  codeTheme?: CodeTheme;
}

/** The note under an answer that did not end normally, if any. */
export function noteKey(m: MessagePublic, reconnecting: boolean, lost: boolean): string | null {
  if (m.status === 'streaming') {
    if (lost) return 'chat.notes.lost';
    return reconnecting ? 'chat.notes.reconnecting' : null;
  }
  if (m.status === 'aborted') return 'chat.notes.aborted';
  if (m.status === 'interrupted') return 'chat.notes.interrupted';
  if (m.status === 'error') return null;
  if (m.finishReason === 'length') return 'chat.notes.length';
  if (m.finishReason === 'unknown') return 'chat.notes.unknown';
  return null;
}

function Details({
  message,
  showCost,
  streaming = false,
}: {
  message: MessagePublic;
  showCost: boolean;
  streaming?: boolean;
}) {
  const t = useT();
  const locale = getLocale();
  const { usage } = message;
  const name = message.model ? shortModelName(message.model.modelId) : t('chat.assistant');
  const cost = showCost && usage ? formatCost(usage.costUsd, locale) : '';
  const first = message.parts[0];
  const agent = first?.type === 'agent' ? first.name : null;
  return (
    <>
      {agent ? (
        <span className={styles.agent} dir="auto">
          {agent}
        </span>
      ) : null}
      {streaming ? null : (
        <>
          <span className={styles.model} title={message.model?.modelId}>
            {name}
          </span>
          <span>
            <time dateTime={new Date(message.createdAt).toISOString()}>
              {formatTime(message.createdAt, locale)}
            </time>
          </span>
          {usage?.durationMs != null ? (
            <span>{formatDuration(usage.durationMs, locale)}</span>
          ) : null}
          {cost ? <span>{cost}</span> : null}
        </>
      )}
    </>
  );
}

const NO_SOURCES: Source[] = [];

/**
 * The citation matcher for these sources. It changes only when the sources do, so finished
 * blocks of the answer are not rendered again on every streamed frame.
 */
function useCitations(sources: Source[]) {
  const key = sources.map((s) => `${s.n} ${s.url}`).join('\n');
  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands for the sources' content
  return useMemo(() => (sources.length > 0 ? citationLinks(sources) : undefined), [key]);
}

export const AssistantMessage = memo(
  function AssistantMessage({
    item,
    showCost,
    reconnecting,
    lost = false,
    codeTheme = 'auto',
  }: AssistantMessageProps) {
    const t = useT();
    const { regenerate } = useChatActions();
    const bodyRef = useRef<HTMLDivElement>(null);
    const { message } = item;
    const streaming = message.status === 'streaming' && !lost;
    const version = useProjectVersion(message.id);
    const parentId = message.parentId;
    const retry = parentId ? () => void regenerate(parentId) : undefined;

    // The part being written is the last one before any trailing sources.
    let liveIndex = -1;
    if (streaming) {
      liveIndex = message.parts.length - 1;
      if (message.parts[liveIndex]?.type === 'sources') liveIndex -= 1;
    }
    const failedWithoutDetail =
      message.status === 'error' && !message.parts.some((p) => p.type === 'error');
    const note = noteKey(message, reconnecting, lost);
    // Nothing is being written while a tool waits for your answer: the caret rests, and the
    // answer is not busy, so assistive technology reaches the prompt's buttons.
    const waitingOnYou = message.parts.some(
      (p) => p.type === 'tool_call' && p.status === 'awaiting_approval',
    );
    const label = message.model ? shortModelName(message.model.modelId) : t('chat.assistant');

    const last = message.parts.at(-1);
    const sources = last?.type === 'sources' ? last.sources : NO_SOURCES;
    const linkClass = useCitations(sources);
    const citation = useCitationCard();
    const activity = useGenerations((s) => s.byMessage[message.id]?.activity ?? 'idle');
    // The activity line goes right above the sources, or after everything when there are none.
    const activityAt = last?.type === 'sources' ? message.parts.length - 1 : message.parts.length;
    const activityRow = (
      <ActivityRow
        // A new activity remounts the row, so its time counts from its own start.
        key={`activity:${activity}`}
        activity={activity}
        streaming={streaming}
        searches={message.usage?.webSearchRequests ?? 0}
      />
    );

    return (
      <MessageItem
        kind="assistant"
        label={label}
        meta={
          streaming && message.parts[0]?.type !== 'agent' ? null : (
            <Details message={message} showCost={showCost} streaming={streaming} />
          )
        }
      >
        <div
          ref={bodyRef}
          className={styles.parts}
          aria-busy={(streaming && !waitingOnYou) || undefined}
        >
          {message.parts.flatMap((part, i) => [
            ...(i === activityAt ? [activityRow] : []),
            <PartRenderer
              // biome-ignore lint/suspicious/noArrayIndexKey: parts only grow; earlier ones keep their place
              key={i}
              part={part}
              message={message}
              live={i === liveIndex}
              codeTheme={codeTheme}
              onRetry={retry}
              linkClass={linkClass}
              onCitation={citation.onCitation}
            />,
          ])}
          {activityAt === message.parts.length ? activityRow : null}
        </div>
        <CitationCard
          sources={sources}
          anchor={citation.anchor}
          onClose={citation.close}
          onHold={citation.hold}
        />
        {streaming && !waitingOnYou ? <Caret targetRef={bodyRef} /> : null}
        {failedWithoutDetail ? (
          <div className={styles.failed}>
            <p>{t('chat.streamFailed')}</p>
            {retry ? (
              <Button size="sm" onClick={retry}>
                {t('common.retry')}
              </Button>
            ) : null}
          </div>
        ) : null}
        {version && !streaming ? (
          <Suspense fallback={null}>
            <ProjectChangeRow
              conversationId={message.conversationId}
              messageId={message.id}
              version={version}
            />
          </Suspense>
        ) : null}
        {note ? <p className={styles.note}>{t(note)}</p> : null}
        {streaming ? null : <MessageActions item={item} />}
      </MessageItem>
    );
  },
  (a, b) =>
    sameItem(a.item, b.item) &&
    a.showCost === b.showCost &&
    a.reconnecting === b.reconnecting &&
    a.lost === b.lost &&
    a.codeTheme === b.codeTheme,
);
