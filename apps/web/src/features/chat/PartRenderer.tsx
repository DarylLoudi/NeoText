import type { MessagePart, MessagePublic } from '@neotext/shared';
import { type ComponentType, memo } from 'react';
import { useT } from '../../lib/i18n';
import { Button } from '../../ui';
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

function TextPart({ part, live, codeTheme, linkClass, onCitation }: PartProps<'text'>) {
  return (
    <Markdown
      text={part.text}
      streaming={live}
      codeTheme={codeTheme}
      linkClass={linkClass}
      onCitation={onCitation}
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

/** The generation id comes from the live store, so a prompt can answer after a resume too. */
function ToolPart({ part, message }: PartProps<'tool_call'>) {
  const { generationId, ended, stuck, retry } = useCallLife(part, message);
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
  sources: SourcesPart,
  attachment: AttachmentPart,
  error: ErrorPart,
};

export function PartRenderer(props: PartProps) {
  const Component = partRenderers[props.part.type] as ComponentType<PartProps>;
  return <Component {...props} />;
}
