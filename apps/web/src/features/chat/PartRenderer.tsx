import { type MessagePart, type MessagePublic, PROJECT_TOOLS } from '@neotext/shared';
import { type ComponentType, lazy, memo, Suspense, useCallback } from 'react';
import { useT } from '../../lib/i18n';
import { Button } from '../../ui';
import { openProjectPanel } from '../project/project-panel-state';
import { useProjectVersion } from '../project/project-versions';
import { AttachmentView } from './AttachmentView';
import type { CodeTheme } from './markdown/highlight';
import { Markdown } from './markdown/Markdown';
import type { RenderOptions } from './markdown/render';
import styles from './PartRenderer.module.css';
import { ReasoningBlock } from './ReasoningBlock';
import type { CitationHandler } from './sources/CitationCard';
import { SourcesStrip } from './sources/SourcesStrip';
import { ToolCallBlock } from './tools/ToolCallBlock';
import { useCallLife } from './tools/use-call-life';

type PartType = MessagePart['type'];

const PROJECT_FILE_CALLS: ReadonlySet<string> = new Set(Object.values(PROJECT_TOOLS));
const isProjectFileCall = (name: string) => PROJECT_FILE_CALLS.has(name);

export interface PartProps<T extends PartType = PartType> {
  part: Extract<MessagePart, { type: T }>;
  message: MessagePublic;
  /** True for the part being written right now. */
  live: boolean;
  codeTheme: CodeTheme;
  /** Asks for the answer again (shown on error parts). */
  onRetry?: () => void;
  /** Marks links to the answer's sources as citation chips; must be stable between frames. */
  linkClass?: RenderOptions['linkClass'];
  onCitation?: CitationHandler;
}

function TextPart({ part, message, live, codeTheme, linkClass, onCitation }: PartProps<'text'>) {
  const { conversationId, id, role } = message;
  // Stable per message, so the rendered blocks are not rebuilt on every frame.
  const onPreview = useCallback(() => openProjectPanel(conversationId, id), [conversationId, id]);
  return (
    <Markdown
      text={part.text}
      streaming={live}
      codeTheme={codeTheme}
      linkClass={linkClass}
      onCitation={onCitation}
      {...(role === 'assistant' ? { onPreview } : {})}
    />
  );
}

/**
 * The sources part keeps its identity while text streams (see apply-event), so the strip
 * renders again only when sources arrive.
 */
const SourcesPart = memo(
  function SourcesPart({ part }: PartProps<'sources'>) {
    if (part.sources.length === 0) return null;
    return <SourcesStrip sources={part.sources} />;
  },
  (a, b) => a.part.sources === b.part.sources,
);

// Loaded the first time an answer delegates, so plain chats do not pay for it.
const SubagentCard = lazy(() =>
  import('./tools/SubagentCard').then((m) => ({ default: m.SubagentCard })),
);

/** The generation id comes from the live store, so a prompt can answer after a resume too. */
function ToolPart({ part, message }: PartProps<'tool_call'>) {
  const { generationId, ended, stuck, retry } = useCallLife(part, message);
  // A finished answer whose changes have a project row shows that row instead (AssistantMessage).
  const folded = useProjectVersion(message.id) !== undefined;
  if (
    folded &&
    isProjectFileCall(part.name) &&
    part.status === 'ok' &&
    message.status !== 'streaming'
  ) {
    return null;
  }
  // Delegated work gets its own card; without runs to show, the generic row stands in.
  if (part.name === 'delegate_tasks') {
    // A refused second delegation has no runs and nothing worth showing.
    if (!part.agents || part.agents.length === 0) return null;
    return (
      <Suspense fallback={null}>
        <SubagentCard part={{ ...part, agents: part.agents }} ended={ended} />
      </Suspense>
    );
  }
  return (
    <ToolCallBlock
      part={part}
      generationId={generationId}
      ended={ended}
      stuck={stuck}
      onRetry={retry}
    />
  );
}

function ReasoningPart({ part, live }: PartProps<'reasoning'>) {
  return <ReasoningBlock part={part} live={live} />;
}

/** Error codes the app explains in the reader's language; others show the server's sentence. */
const ERROR_COPY: Record<string, string> = { thinking_budget: 'chat.errors.thinkingBudget' };

export function ErrorPart({ part, onRetry }: PartProps<'error'>) {
  const t = useT();
  const key = ERROR_COPY[part.code];
  return (
    <div className={styles.error}>
      <p dir="auto">{key ? t(key) : part.message}</p>
      {onRetry ? (
        <Button size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      ) : null}
    </div>
  );
}

function AttachmentPart({ part }: PartProps<'attachment'>) {
  return <AttachmentView parts={[part]} />;
}

/** One renderer per part type. */
export const partRenderers: { [K in PartType]: ComponentType<PartProps<K>> } = {
  text: TextPart,
  reasoning: ReasoningPart,
  tool_call: ToolPart,
  agent: () => null,
  sources: SourcesPart,
  attachment: AttachmentPart,
  error: ErrorPart,
};

export function PartRenderer(props: PartProps) {
  const Component = partRenderers[props.part.type] as ComponentType<PartProps>;
  return <Component {...props} />;
}
