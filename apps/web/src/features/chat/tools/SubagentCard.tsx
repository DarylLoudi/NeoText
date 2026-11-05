import type { SubagentRun, ToolCallPart } from '@neotext/shared';
import {
  CaretRight,
  CheckCircle,
  CircleNotch,
  Globe,
  MagnifyingGlass,
  Robot,
  StopCircle,
  WarningCircle,
  Wrench,
} from '@phosphor-icons/react';
import { type CSSProperties, useEffect, useId, useState } from 'react';
import { formatCost, formatDuration } from '../../../lib/format';
import { useT } from '../../../lib/i18n';
import { Markdown } from '../markdown/Markdown';
import styles from './SubagentCard.module.css';

export interface SubagentCardProps {
  part: ToolCallPart & { agents: SubagentRun[] };
  /** Nothing runs for this call any more: a row still marked running was stopped. */
  ended?: boolean;
}

type RunStatus = SubagentRun['status'];

/** The server lists each sub-agent tool call on its run; older answers have none. */
type RunWithCalls = SubagentRun & { toolCalls?: { name: string; detail: string }[] };

function CallIcon({ name }: { name: string }) {
  if (name === 'web_search') return <MagnifyingGlass aria-hidden />;
  if (name === 'fetch_url') return <Globe aria-hidden />;
  return <Wrench aria-hidden />;
}

/** The clock, ticking each second while `live`. */
function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  return now;
}

/** Whole seconds while running, so the tick does not flicker through tenths. */
function elapsed(run: SubagentRun, now: number): string {
  if (run.finishedAt !== null) return formatDuration(Math.max(0, run.finishedAt - run.startedAt));
  return formatDuration(Math.floor(Math.max(0, now - run.startedAt) / 1000) * 1000);
}

function StatusIcon({ status }: { status: RunStatus }) {
  if (status === 'running') {
    return (
      <>
        <CircleNotch aria-hidden className={styles.spin} weight="bold" />
        {/* Shown instead of the spinner when motion is reduced. */}
        <span aria-hidden className={styles.dot} />
      </>
    );
  }
  if (status === 'ok') return <CheckCircle aria-hidden className={styles.ok} weight="fill" />;
  if (status === 'error') {
    return <WarningCircle aria-hidden className={styles.error} weight="fill" />;
  }
  return <StopCircle aria-hidden className={styles.stopped} />;
}

function Row({ run, index, now }: { run: SubagentRun; index: number; now: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const cost = run.costUsd !== null ? formatCost(run.costUsd) : '';
  const calls = (run as RunWithCalls).toolCalls ?? [];
  return (
    <li className={styles.row} data-status={run.status} style={{ '--i': index } as CSSProperties}>
      <button
        type="button"
        className={styles.rowButton}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.lead} title={t(`chat.subagents.status.${run.status}`)}>
          <StatusIcon status={run.status} />
          <span className={styles.srOnly}>{t(`chat.subagents.status.${run.status}`)}</span>
        </span>
        <span className={styles.title} dir="auto">
          {run.title}
        </span>
        {run.agentName ? (
          <span className={styles.agent} dir="auto">
            {run.agentName}
          </span>
        ) : null}
        <span className={styles.time}>{elapsed(run, now)}</span>
        {cost ? <span className={styles.cost}>{cost}</span> : null}
        <CaretRight aria-hidden className={styles.chevron} />
      </button>
      {open ? (
        <section
          id={panelId}
          className={styles.report}
          aria-label={t('chat.subagents.report', { title: run.title })}
        >
          {calls.length > 0 ? (
            <ul className={styles.calls}>
              {calls.map((c, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, ordered log
                <li key={i} className={styles.call}>
                  <CallIcon name={c.name} />
                  <span className={styles.callDetail} dir="auto">
                    {c.detail}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {run.report ? (
            <Markdown text={run.report} />
          ) : (
            <p className={styles.empty}>
              {run.status === 'running'
                ? t('chat.subagents.working')
                : t('chat.subagents.noReport')}
            </p>
          )}
        </section>
      ) : null}
    </li>
  );
}

/**
 * The `delegate_tasks` call: one row per sub-agent, live while they work. When all are done it
 * folds into one line that opens again on click.
 */
export function SubagentCard({ part, ended = false }: SubagentCardProps) {
  const t = useT();
  const bodyId = useId();
  // A run the page saw as running when the answer ended was stopped with it.
  const runs = part.agents.map((r) =>
    ended && r.status === 'running' ? { ...r, status: 'stopped' as const } : r,
  );
  const total = runs.length;
  const done = runs.filter((r) => r.status !== 'running').length;
  const finished = done === total;
  const now = useNow(!finished);
  /** The reader's own choice, kept only for the phase (running or finished) it was made in. */
  const [choice, setChoice] = useState<{ finished: boolean; open: boolean } | null>(null);
  const open = choice && choice.finished === finished ? choice.open : !finished;
  const toggle = () => setChoice({ finished, open: !open });

  const failed = runs.filter((r) => r.status === 'error').length;
  const stopped = runs.filter((r) => r.status === 'stopped').length;
  const costs = runs.map((r) => r.costUsd).filter((c): c is number => c !== null);
  const cost = costs.length > 0 ? formatCost(costs.reduce((a, b) => a + b, 0)) : '';
  const first = Math.min(...runs.map((r) => r.startedAt));
  const last = Math.max(...runs.map((r) => r.finishedAt ?? r.startedAt));
  const span = formatDuration(Math.max(0, last - first));

  const header = finished ? (
    <>
      <span className={styles.headTitle}>{t('chat.subagents.finished', { count: total })}</span>
      <span className={styles.meta}>{span}</span>
      {cost ? <span className={styles.meta}>{cost}</span> : null}
      {failed > 0 ? (
        <span className={styles.failed}>{t('chat.subagents.failed', { count: failed })}</span>
      ) : null}
      {stopped > 0 ? (
        <span className={styles.meta}>{t('chat.subagents.stopped', { count: stopped })}</span>
      ) : null}
    </>
  ) : (
    <>
      <span className={styles.headTitle}>{t('chat.subagents.title')}</span>
      <span className={styles.meta}>{t('chat.subagents.tasks', { count: total })}</span>
      <span className={styles.progressText}>{t('chat.subagents.progress', { done, total })}</span>
    </>
  );

  return (
    // `data-caret` keeps the writing caret out of the card: it belongs after the answer's text.
    <div
      className={styles.card}
      data-finished={finished}
      data-caret=""
      aria-busy={!finished || undefined}
    >
      <button
        type="button"
        className={styles.head}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={toggle}
      >
        <Robot aria-hidden className={styles.robot} weight={finished ? 'regular' : 'bold'} />
        {header}
        <CaretRight aria-hidden className={styles.chevron} />
      </button>
      {finished ? null : (
        <div
          className={styles.track}
          role="progressbar"
          aria-label={t('chat.subagents.title')}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
        >
          <span className={styles.fill} style={{ inlineSize: `${(done / total) * 100}%` }} />
        </div>
      )}
      {open ? (
        <ul id={bodyId} className={styles.rows}>
          {runs.map((run, i) => (
            <Row key={run.id} run={run} index={i} now={now} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
