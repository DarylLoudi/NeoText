import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ensureMarkdown, type MarkdownEngine, markdownEngine } from './engine';
import type { CodeTheme } from './highlight';
import styles from './Markdown.module.css';
import { ensureMath, hasMath, isMathReady } from './math';
import type { RenderOptions } from './render';
import { repairStreaming } from './repair';

export interface MarkdownProps {
  text: string;
  /** True while the reply is still arriving: the last block is repaired and not highlighted. */
  streaming?: boolean;
  linkClass?: RenderOptions['linkClass'];
  codeTheme?: CodeTheme;
  /**
   * Told when the pointer or focus enters (the chip) or leaves (null) a citation chip
   * (`.md-cite`). One delegated listener on the root; the blocks never re-render for it.
   */
  onCitation?: (cite: HTMLElement | null, via: 'hover' | 'focus') => void;
  /** Opens the chat's project preview; HTML page blocks get a Preview button when set. */
  onPreview?: () => void;
}

const CITE = '.md-cite';

/** The citation chip an event happened in, if any. */
function citeOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(CITE) : null;
}

const COPIED_MS = 2000;

/** The code each card was rendered with, so copying never depends on highlighted markup. */
const codeSources = new WeakMap<Element, string>();

function whenIdle(callback: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(callback, { timeout: 1000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(callback, 0);
  return () => clearTimeout(id);
}

/**
 * Gives each citation chip a name with its source number ("Source 3: the guide"); the number
 * is CSS generated content, which not every screen reader reads.
 */
function labelCitations(root: HTMLElement, label: RenderOptions['citationLabel']): void {
  if (!label) return;
  for (const el of root.querySelectorAll<HTMLElement>(CITE)) {
    const n = el.dataset.source ?? '';
    el.setAttribute('aria-label', label(n, el.textContent ?? ''));
  }
}

/** Makes scrollable regions reachable by keyboard; markup from the sanitizer cannot carry it. */
function markFocusable(root: HTMLElement): void {
  for (const el of root.querySelectorAll<HTMLElement>('.md-code pre, .md-table')) {
    if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
  }
}

function highlightCards(
  root: HTMLElement,
  theme: CodeTheme,
  highlightCode: MarkdownEngine['highlightCode'],
  signal: { cancelled: boolean },
): void {
  const cards = root.querySelectorAll<HTMLElement>('.md-code[data-lang]');
  for (const card of cards) {
    const lang = card.dataset.lang ?? '';
    if (lang === '' || card.dataset.highlighted === theme) continue;
    const source = codeSources.get(card) ?? card.querySelector('code')?.textContent ?? '';
    codeSources.set(card, source);
    whenIdle(() => {
      if (signal.cancelled) return;
      void highlightCode(source, lang, theme).then((html) => {
        if (signal.cancelled || !html || !card.isConnected) return;
        const template = document.createElement('template');
        template.innerHTML = html;
        const pre = template.content.firstElementChild;
        if (!(pre instanceof HTMLElement)) return;
        pre.tabIndex = 0;
        card.querySelector('pre')?.replaceWith(pre);
        card.dataset.highlighted = theme;
      });
    });
  }
}

interface BlockProps {
  engine: MarkdownEngine;
  text: string;
  live: boolean;
  opts: RenderOptions;
  theme: CodeTheme;
  mathReady: boolean;
}

const Block = memo(function Block({ engine, text, live, opts, theme, mathReady }: BlockProps) {
  // mathReady is a dependency on purpose: once KaTeX loads, blocks with math render again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  const html = useMemo(
    () => engine.renderBlock(live ? repairStreaming(text) : text, opts),
    [engine, text, live, opts, mathReady],
  );
  const ref = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: html is what the DOM was set from
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    markFocusable(root);
    labelCitations(root, opts.citationLabel);
    if (live) return;
    const signal = { cancelled: false };
    highlightCards(root, theme, engine.highlightCode, signal);
    return () => {
      signal.cancelled = true;
    };
  }, [html, live, theme, engine]);

  // renderBlock output always passes through DOMPurify (sanitize.ts); nothing else reaches here.
  // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized markdown HTML
  return <div ref={ref} className={styles.block} dangerouslySetInnerHTML={{ __html: html }} />;
});

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** The renderer, or null on the renders before its chunk has arrived. */
function useMarkdownEngine(): MarkdownEngine | null {
  const [engine, setEngine] = useState(markdownEngine);
  useEffect(() => {
    if (engine) return;
    let active = true;
    ensureMarkdown().then(
      (loaded) => active && setEngine(loaded),
      () => undefined, // the chunk failed to load: the text stays as written
    );
    return () => {
      active = false;
    };
  }, [engine]);
  return engine;
}

/**
 * Renders a message's markdown. Until the renderer's chunk has loaded (it is fetched on idle
 * from the chat view, so usually it already has), the text shows as written.
 */
export function Markdown(props: MarkdownProps) {
  const engine = useMarkdownEngine();
  if (!engine) {
    return (
      <div className={styles.root}>
        <div className={styles.plain} dir="auto">
          {props.text}
        </div>
      </div>
    );
  }
  return <RichMarkdown engine={engine} {...props} />;
}

function RichMarkdown({
  engine,
  text,
  streaming = false,
  linkClass,
  codeTheme = 'auto',
  onCitation,
  onPreview,
}: MarkdownProps & { engine: MarkdownEngine }) {
  const { t } = useTranslation();
  const [mathReady, setMathReady] = useState(isMathReady);
  const previous = useRef<{ blocks: string[]; mathReady: boolean }>({
    blocks: [],
    mathReady,
  });
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const opts = useMemo<RenderOptions>(
    () => ({
      copyLabel: t('common.copy'),
      loadImageLabel: (host) => t('chat.markdown.loadImage', { host }),
      citationLabel: (n, text) => t('chat.markdown.citation', { n, text }),
      linkClass,
      ...(onPreview ? { previewLabel: t('chat.project.previewCode') } : {}),
    }),
    [t, linkClass, onPreview],
  );

  useEffect(() => {
    if (mathReady || !hasMath(text)) return;
    let active = true;
    ensureMath().then(
      () => active && setMathReady(true),
      () => undefined, // KaTeX failed to load: math stays as plain text
    );
    return () => {
      active = false;
    };
  }, [text, mathReady]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);

  // Blocks before the last cannot change while text is appended, so only the tail is re-split.
  const blocks = useMemo(() => {
    const { blocks: before, mathReady: wasReady } = previous.current;
    const next =
      wasReady === mathReady ? engine.updateBlocks(before, text) : engine.splitBlocks(text);
    previous.current = { blocks: next, mathReady };
    return next;
  }, [engine, text, mathReady]);

  const onClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!(event.target instanceof Element)) return;

      if (onPreview && event.target.closest('[data-preview]')) {
        onPreview();
        return;
      }

      const copy = event.target.closest<HTMLElement>('[data-copy]');
      if (copy) {
        const card = copy.closest('.md-code');
        const code = (card && codeSources.get(card)) ?? card?.querySelector('code')?.textContent;
        if (code === undefined || !navigator.clipboard) return;
        navigator.clipboard.writeText(code).then(
          () => {
            const name = copy.querySelector('.md-sr') ?? copy;
            name.textContent = t('common.copied');
            copy.title = t('common.copied');
            copy.dataset.copied = '';
            const timer = setTimeout(() => {
              name.textContent = opts.copyLabel;
              copy.title = opts.copyLabel;
              delete copy.dataset.copied;
              timers.current.delete(timer);
            }, COPIED_MS);
            timers.current.add(timer);
          },
          () => undefined,
        );
        return;
      }

      const load = event.target.closest<HTMLElement>('[data-image-url]');
      if (load) {
        const src = load.dataset.imageUrl ?? '';
        if (!src.startsWith('https://') || !hostOf(src)) return;
        const img = document.createElement('img');
        img.setAttribute('referrerpolicy', 'no-referrer');
        img.setAttribute('loading', 'lazy');
        img.setAttribute('decoding', 'async');
        img.alt = load.dataset.imageAlt ?? '';
        img.src = src;
        load.replaceWith(img);
      }
    },
    [t, opts, onPreview],
  );

  // Moving within one chip (onto its text node's parent, say) is not leaving it.
  const citationEvents = onCitation
    ? {
        onPointerOver: (e: React.PointerEvent) => {
          const cite = citeOf(e.target);
          if (cite && cite !== citeOf(e.relatedTarget)) onCitation(cite, 'hover');
        },
        onPointerOut: (e: React.PointerEvent) => {
          const cite = citeOf(e.target);
          if (cite && cite !== citeOf(e.relatedTarget)) onCitation(null, 'hover');
        },
        onFocus: (e: React.FocusEvent) => {
          const cite = citeOf(e.target);
          if (cite) onCitation(cite, 'focus');
        },
        onBlur: (e: React.FocusEvent) => {
          if (citeOf(e.target)) onCitation(null, 'focus');
        },
      }
    : {};

  const lastIndex = blocks.length - 1;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: one delegated handler; the real buttons inside are keyboard-operable
    // biome-ignore lint/a11y/noStaticElementInteractions: the clicks it handles come from buttons in the markup
    <div className={styles.root} onClick={onClick} {...citationEvents}>
      {blocks.map((block, index) => (
        <Block
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks only ever grow at the end
          key={index}
          engine={engine}
          text={block}
          live={streaming && index === lastIndex}
          opts={opts}
          theme={codeTheme}
          mathReady={mathReady}
        />
      ))}
    </div>
  );
}
