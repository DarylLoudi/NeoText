import type { ApprovalBody, ToolCallPart } from '@neotext/shared';
import { CaretDown, ShieldCheck } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { chatApi } from '../../../lib/api/chat';
import { ApiError } from '../../../lib/api/client';
import { useT } from '../../../lib/i18n';
import { qk } from '../../../lib/query';
import { refetchSettings } from '../../../state/settings';
import { Button } from '../../../ui';
import styles from './ApprovalPrompt.module.css';
import { ReconnectNotice } from './ReconnectNotice';
import { shownArgs, useCallName } from './tool-names';
import { useMoreBelow } from './use-more-below';

/** Arguments up to this length show in full; longer ones are too long to review, so never allowed. */
export const APPROVAL_ARGS_MAX = 64 * 1024;

export interface ApprovalPromptProps {
  call: ToolCallPart;
  /** The live generation waiting on the answer; null while the page is still reconnecting to it. */
  generationId: string | null;
  /** The page cannot tell whether the call is still waiting. */
  stuck?: boolean;
  /** Tries to reach the call again, when `stuck`. */
  onRetry?: (() => void) | undefined;
}

type Choice = 'allow' | 'always' | 'deny';

const BODY: Record<Choice, Omit<ApprovalBody, 'callId'>> = {
  allow: { decision: 'allow', remember: false },
  always: { decision: 'allow', remember: true },
  deny: { decision: 'deny', remember: false },
};

/**
 * Asks before a tool runs. It is drawn from the call's own status, which the generation
 * snapshot carries, so the question is still here after a reload or a resumed stream. The name
 * and arguments are the only thing the choice rests on, so Allow is on offer only while they
 * show complete, with nothing unseen and a cue when more lies below the fold. Arguments too long
 * to review can only be declined.
 */
export function ApprovalPrompt({
  call,
  generationId,
  stuck = false,
  onRetry,
}: ApprovalPromptProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const titleId = useId();
  const name = useCallName(call);
  const args = useMemo(() => shownArgs(call.args, APPROVAL_ARGS_MAX), [call.args]);
  const tooLong = args.truncated;
  const argsRef = useRef<HTMLPreElement>(null);
  const moreBelow = useMoreBelow(argsRef, args.text);
  // Which choice was sent for which call; a new call starts with nothing sent.
  const [sent, setSent] = useState<{ callId: string; choice: Choice } | null>(null);
  const [failure, setFailure] = useState<{ callId: string; message: string } | null>(null);
  const sending = sent?.callId === call.id ? sent.choice : null;
  const error = failure?.callId === call.id ? failure.message : null;

  // Set after mounting: a live region announces changes, not what it starts with.
  const announcement = !generationId
    ? ''
    : tooLong
      ? t('chat.tools.approval.tooLong')
      : t('chat.tools.approval.announce', { tool: name });
  const [announced, setAnnounced] = useState('');
  useEffect(() => setAnnounced(announcement), [announcement]);

  async function answer(choice: Choice) {
    if (!generationId || (tooLong && choice !== 'deny')) return;
    setSent({ callId: call.id, choice });
    setFailure(null);
    try {
      await chatApi.approve(generationId, { callId: call.id, ...BODY[choice] });
      // The stream moves the call on (running or declined); until then the buttons stay off.
    } catch (err) {
      setSent(null);
      setFailure({
        callId: call.id,
        message: err instanceof ApiError ? err.message : t('common.genericError'),
      });
      return;
    }
    if (BODY[choice].remember) {
      // The server saved the tool's new policy itself, so this page has to ask for it.
      void refetchSettings();
      void queryClient.invalidateQueries({ queryKey: qk.tools });
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset's legend would not lay out with the panel
    <div className={styles.prompt} role="group" aria-labelledby={titleId}>
      <p className={styles.announce} role="status">
        {announced}
      </p>
      <p id={titleId} className={styles.title}>
        <ShieldCheck aria-hidden className={styles.icon} />
        <span className={styles.name} dir="ltr">
          {t('chat.tools.approval.title', { tool: name })}
        </span>
      </p>
      <div className={styles.argsBox}>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: long arguments scroll by keyboard too */}
        <pre ref={argsRef} className={styles.args} dir="ltr" tabIndex={0}>
          {args.text}
        </pre>
        {moreBelow ? (
          <span className={styles.more}>
            <CaretDown aria-hidden />
            {t('chat.tools.approval.moreBelow')}
          </span>
        ) : null}
      </div>
      {generationId ? (
        <>
          <div className={styles.actions}>
            <Button
              size="sm"
              variant="primary"
              loading={sending === 'allow'}
              disabled={sending !== null || tooLong}
              onClick={() => void answer('allow')}
            >
              {t('chat.tools.approval.allow')}
            </Button>
            <Button
              size="sm"
              loading={sending === 'always'}
              disabled={sending !== null || tooLong}
              onClick={() => void answer('always')}
            >
              {t('chat.tools.approval.always')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              loading={sending === 'deny'}
              disabled={sending !== null}
              onClick={() => void answer('deny')}
            >
              {t('chat.tools.approval.decline')}
            </Button>
          </div>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : (
            <p className={styles.hint}>
              {tooLong ? t('chat.tools.approval.tooLong') : t('chat.tools.approval.hint')}
            </p>
          )}
        </>
      ) : stuck ? (
        <ReconnectNotice onRetry={onRetry} />
      ) : null}
    </div>
  );
}
