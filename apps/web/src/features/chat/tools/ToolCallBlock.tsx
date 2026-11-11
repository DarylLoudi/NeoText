import type { ToolCallPart } from '@neotext/shared';
import { BookOpenText, CaretRight, FileText, Globe, Wrench } from '@phosphor-icons/react';
import { lazy, Suspense, useMemo } from 'react';
import { formatDuration } from '../../../lib/format';
import { useT } from '../../../lib/i18n';
import { Spinner } from '../../../ui';
import { Elapsed } from '../Elapsed';
import { ReconnectNotice } from './ReconnectNotice';
import styles from './ToolCallBlock.module.css';
import { ARGS_SHOWN_MAX, callDetail, callLabel, shownArgs, useCallName } from './tool-names';

export interface ToolCallBlockProps {
  part: ToolCallPart;
  /** The live generation the call belongs to; needed to answer an approval prompt. */
  generationId?: string | null;
  /** Nothing runs for this call any more, whatever its saved status says. */
  ended?: boolean;
  /** The page cannot tell whether this call is still going. */
  stuck?: boolean;
  /** Tries to reach the call again, when `stuck`. */
  onRetry?: () => void;
}

function ToolIcon({ name }: { name: string }) {
  if (name === 'web_search') return <Globe aria-hidden className={styles.icon} />;
  if (name === 'fetch_url') return <FileText aria-hidden className={styles.icon} />;
  if (name === 'search_knowledge') return <BookOpenText aria-hidden className={styles.icon} />;
  return <Wrench aria-hidden className={styles.icon} />;
}

// Loaded the first time a call waits for approval: only tools set to "Ask" need it.
const ApprovalPrompt = lazy(() =>
  import('./ApprovalPrompt').then((m) => ({ default: m.ApprovalPrompt })),
);

/**
 * One quiet row per tool call: what it did, how it ended and how long it took. Opening it shows
 * the arguments and the result. Both come from the model, web pages or tool servers, so they are
 * only ever shown as text.
 */
export function ToolCallBlock({
  part,
  generationId = null,
  ended = false,
  stuck = false,
  onRetry,
}: ToolCallBlockProps) {
  const t = useT();
  const name = useCallName(part);
  const { name: rawName, args: rawArgs } = part;
  // Rows render again on every streamed frame; the arguments only change with the call.
  const { detail, args } = useMemo(
    () => ({ detail: callDetail(rawName, rawArgs), args: shownArgs(rawArgs) }),
    [rawName, rawArgs],
  );
  if (part.status === 'awaiting_approval' && !ended) {
    return (
      <Suspense fallback={null}>
        <ApprovalPrompt call={part} generationId={generationId} stuck={stuck} onRetry={onRetry} />
      </Suspense>
    );
  }
  const unfinished = part.status === 'running' || part.status === 'awaiting_approval';
  const running = unfinished && !ended && !stuck;
  const label = callLabel(rawName, name, unfinished && !ended);
  // A call that was declined or never answered did not run.
  const duration =
    part.finishedAt !== null && part.status !== 'denied' && part.status !== 'no_answer'
      ? formatDuration(Math.max(0, part.finishedAt - part.startedAt))
      : null;
  const outcome =
    part.status === 'error'
      ? t('chat.tools.failed')
      : part.status === 'denied'
        ? t('chat.tools.declined')
        : part.status === 'no_answer'
          ? t('chat.tools.noAnswer')
          : unfinished && ended
            ? t('chat.tools.interrupted')
            : unfinished && stuck
              ? t('chat.tools.notConnected')
              : null;

  const row = (
    <details className={styles.block} data-status={part.status} aria-busy={running || undefined}>
      <summary className={styles.summary}>
        <span className={styles.lead}>
          {running ? <Spinner size={14} /> : <ToolIcon name={part.name} />}
        </span>
        <span className={styles.label} dir="ltr" title={label}>
          {label}
        </span>
        {detail ? (
          <span className={styles.detail} dir="ltr">
            {detail}
          </span>
        ) : null}
        {outcome ? <span className={styles.outcome}>{outcome}</span> : null}
        {duration ? <span className={styles.duration}>{duration}</span> : null}
        {running && part.status === 'running' ? (
          <Elapsed since={part.startedAt} className={styles.duration} />
        ) : null}
        <CaretRight aria-hidden className={styles.chevron} />
      </summary>
      <div className={styles.body}>
        <p className={styles.heading}>{t('chat.tools.arguments')}</p>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: long text scrolls by keyboard too */}
        <pre className={styles.args} dir="ltr" tabIndex={0}>
          {args.text}
        </pre>
        {args.truncated ? (
          <p className={styles.note}>{t('chat.tools.argsTruncated', { count: ARGS_SHOWN_MAX })}</p>
        ) : null}
        {part.result !== null ? (
          <>
            <p className={styles.heading}>
              {part.status === 'error' ? t('chat.tools.error') : t('chat.tools.result')}
            </p>
            {/* biome-ignore lint/a11y/noNoninteractiveTabindex: long text scrolls by keyboard too */}
            <p className={styles.result} dir="auto" tabIndex={0}>
              {part.result}
            </p>
          </>
        ) : null}
      </div>
    </details>
  );
  if (!(unfinished && stuck && !ended)) return row;
  return (
    <>
      {row}
      <ReconnectNotice onRetry={onRetry} />
    </>
  );
}
