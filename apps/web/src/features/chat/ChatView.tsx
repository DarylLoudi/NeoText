import { type ModelRef, modelKey } from '@neotext/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { lazy, type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../lib/api/client';
import { useAppCommand } from '../../lib/app-commands';
import { useT } from '../../lib/i18n';
import { useGenerations } from '../../state/generations';
import { useSettings } from '../../state/settings';
import { Button, EmptyState, toast } from '../../ui';
import { useCompare } from '../compare/compare-state';
import { setPendingPreset, usePendingPreset } from '../presets/use-presets';
import { panelPathFor } from '../project/panel-path';
import { previewStorage } from '../project/preview-storage';
import { closeProjectPanel, useProjectPanel } from '../project/project-panel-state';
import { ProjectContext, useChatProject } from '../project/project-versions';
import { TopBarSlot } from '../shell/TopBar';
import styles from './ChatView.module.css';
import { Composer } from './composer/Composer';
import { ModelButton, ModelPicker } from './composer/ModelPicker';
import { ModelSheet } from './composer/ModelSheet';
import { useActiveModel } from './composer/use-models';
import { effectiveContextLength, needsNewChat } from './context-window';
import { useJumpToMessage } from './jump-to-message';
import { type ChatActions, ChatActionsContext } from './MessageActions';
import { MessageList } from './MessageList';
import { prefetchMarkdown } from './markdown/engine';
import { setNextChatModel, takeNextChatModel } from './next-chat-model';
import { conversationDetailQuery, useChatStream } from './streaming/use-chat-stream';
import { buildThread } from './thread';

// The preview panel and everything it runs load the first time a chat opens it.
const ProjectPanel = lazy(() => import('../project/ProjectPanel'));
const PreviewToggle = lazy(() =>
  import('../project/ProjectChangeRow').then((m) => ({ default: m.PreviewToggle })),
);

/** Performance marks around opening a chat (budget: 100 ms to first paint of messages). */
export const OPEN_START_MARK = 'neotext:open-start';
export const MESSAGES_PAINTED_MARK = 'neotext:messages-painted';

function mark(name: string, conversationId: string): void {
  if (typeof performance?.mark === 'function')
    performance.mark(name, { detail: { conversationId } });
}

/**
 * Marks when this chat's view starts rendering and when its messages first reach the screen:
 * the frame after they are committed, once the browser has painted it.
 */
function useOpenMarks(conversationId: string | null, hasMessages: boolean): void {
  // The view is keyed by chat, so this runs once per opened chat, at its first render.
  useState(() => conversationId && mark(OPEN_START_MARK, conversationId));
  const painted = useRef(false);
  useEffect(() => {
    if (!conversationId || !hasMessages || painted.current) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => {
        painted.current = true;
        mark(MESSAGES_PAINTED_MARK, conversationId);
      }, 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [conversationId, hasMessages]);
}

export interface ChatViewProps {
  /** Null for a new chat that has no messages yet. */
  conversationId: string | null;
  /** Shown in the empty chat's sheet, under the model details (starting points from presets). */
  presets?: ReactNode;
  /** A message to scroll to and mark, from a search result (`?m=`). */
  focusMessageId?: string;
}

export function ChatView({ conversationId, presets, focusMessageId }: ChatViewProps) {
  const t = useT();
  const stream = useChatStream(conversationId);
  const detail = useQuery({
    ...conversationDetailQuery(conversationId ?? ''),
    enabled: conversationId !== null,
  });
  useJumpToMessage(conversationId, focusMessageId, detail.data);
  // The markdown renderer is a lazy chunk; fetch it before the first message needs it.
  useEffect(() => prefetchMarkdown(), []);
  const byMessage = useGenerations((s) => s.byMessage);
  const showCost = useSettings((s) => s.settings.appearance.showCost);
  const codeTheme = useSettings((s) => s.settings.appearance.codeTheme);
  /** The model picked in the top bar for the next message; it wins over the chat's own. */
  const [pending, setPending] = useState<ModelRef | null>(null);
  const navigate = useNavigate();
  const overrides = useSettings((s) => s.settings.models.overrides);
  // A new chat may start from a preset: its model stands in until one is picked here.
  const started = usePendingPreset();
  const preset = conversationId === null ? started : null;
  const presetModel = preset?.data.model ?? null;
  const presetId = preset?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different preset drops the pick
  useEffect(() => setPending(null), [presetId]);
  // A new chat started by a model switch opens with that model.
  useEffect(() => {
    if (conversationId === null) {
      const picked = takeNextChatModel();
      if (picked) setPending(picked);
    }
  }, [conversationId]);
  const active = useActiveModel(detail.data?.conversation ?? null, pending ?? presetModel);
  const panel = useProjectPanel();
  const panelOpen =
    conversationId !== null && panel.open && panel.conversationId === conversationId;
  const hasMessages = (detail.data?.messages.length ?? 0) > 0;

  /** A pick in a chat with messages and a different context window starts a new chat instead. */
  const pick = (ref: ModelRef) => {
    const next = active.byKey.get(modelKey(ref)) ?? null;
    if (
      conversationId !== null &&
      hasMessages &&
      needsNewChat(
        effectiveContextLength(active.model, overrides),
        effectiveContextLength(next, overrides),
      )
    ) {
      setPendingPreset(null);
      setNextChatModel(ref);
      void navigate({ to: '/' });
      toast({ message: t('shell.contextChanged') });
      return;
    }
    setPending(ref);
  };
  // The command palette's "Use <model>" lands here, like a pick from the top bar.
  useAppCommand('switch-model', pick);
  const providerName =
    active.providers.find((p) => p.providerId === active.model?.providerId)?.providerName ?? null;

  /** Answers picked from a comparison; the thread rebuilds when one is picked or reopened. */
  const chosen = useCompare((s) => s.chosen);
  const items = useMemo(() => {
    if (!detail.data) return [];
    const { messages, conversation } = detail.data;
    return buildThread(
      messages,
      conversation.activeLeafId,
      (id) => byMessage[id]?.message,
      (userMessageId) => chosen.has(userMessageId),
    );
  }, [detail.data, byMessage, chosen]);

  /**
   * The visible branch's project, from the stored messages only: rows and the top bar switch
   * appear once an answer is saved, and streaming frames do not replay the project.
   */
  const storedPath = useMemo(() => {
    if (!detail.data) return [];
    const { messages, conversation } = detail.data;
    return buildThread(messages, conversation.activeLeafId, () => undefined).map((i) => i.message);
  }, [detail.data]);
  const project = useChatProject(storedPath);

  /**
   * The branch the open panel shows: the visible one with live answers, or the branch of the
   * answer it was opened from when that one is not on it (a compare column).
   */
  const panelView = useMemo(
    () =>
      panelOpen && detail.data
        ? panelPathFor(items, detail.data.messages, panel.messageId, (id) => byMessage[id]?.message)
        : { path: [], messageId: null },
    [panelOpen, detail.data, items, panel.messageId, byMessage],
  );

  const { reconnecting, lost } = useMemo(() => {
    const live = Object.values(byMessage);
    return {
      reconnecting: new Set(live.flatMap((g) => (g.reconnecting ? [g.message.id] : []))),
      lost: new Set(live.flatMap((g) => (g.lost ? [g.message.id] : []))),
    };
  }, [byMessage]);

  const actions = useMemo<ChatActions>(
    () => ({
      conversationId,
      generating: stream.generating,
      regenerate: (userMessageId, target) => stream.regenerate(userMessageId, target),
      editAndResend: stream.editAndResend,
    }),
    [conversationId, stream],
  );

  // A chat with no messages yet, loaded or not started: the model sheet instead of a transcript.
  const empty = conversationId === null || (detail.data !== undefined && items.length === 0);
  useOpenMarks(conversationId, items.length > 0);

  if (detail.isError && !detail.data) {
    const missing = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <main className={styles.notice}>
        <EmptyState
          title={missing ? t('chat.notFound') : t('chat.loadFailed')}
          action={
            missing ? null : (
              <Button onClick={() => void detail.refetch()}>{t('common.retry')}</Button>
            )
          }
        />
      </main>
    );
  }

  return (
    <ChatActionsContext.Provider value={actions}>
      <ProjectContext.Provider value={project}>
        <div className={styles.layout}>
          <main className={styles.view} aria-busy={detail.isPending && conversationId !== null}>
            <TopBarSlot name="model">
              {conversationId !== null && project.hasPage ? (
                <Suspense fallback={null}>
                  <PreviewToggle conversationId={conversationId} hasPage />
                </Suspense>
              ) : null}
              <ModelPicker value={active.ref} onChange={pick} align="end">
                <ModelButton model={active.model} />
              </ModelPicker>
            </TopBarSlot>
            {empty ? (
              <div className={styles.sheet}>
                <ModelSheet
                  model={active.model}
                  providerName={providerName}
                  hasProvider={active.providers.length > 0}
                  loading={active.isLoading}
                  presets={presets}
                />
              </div>
            ) : (
              <MessageList
                items={items}
                showCost={showCost}
                codeTheme={codeTheme}
                reconnecting={reconnecting}
                lost={lost}
                focusId={focusMessageId}
              />
            )}
            <Composer
              conversationId={conversationId}
              model={active.model}
              stream={stream}
              preset={preset}
            />
          </main>
          {panelOpen ? (
            <Suspense fallback={null}>
              <ProjectPanel
                conversationId={conversationId}
                title={detail.data?.conversation.title ?? ''}
                path={panelView.path}
                generating={stream.generating}
                storage={previewStorage}
                messageId={panelView.messageId}
                onClose={closeProjectPanel}
              />
            </Suspense>
          ) : null}
        </div>
      </ProjectContext.Provider>
    </ChatActionsContext.Provider>
  );
}
