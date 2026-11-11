import MarkdownIt, { type Env, type RendererRule, type StateCore, type Token } from 'markdown-it';
import { applyMath } from './math';
import { sanitizeHtml } from './sanitize';

export interface LinkMark {
  className: string;
  attrs: Record<string, string>;
}

export interface RenderOptions {
  copyLabel: string;
  loadImageLabel: (host: string) => string;
  /** Lets a caller mark some links, for example citations. Return null to leave it. */
  linkClass?: (href: string) => LinkMark | null;
  /** The accessible name of a citation chip, whose number is drawn by CSS only. */
  citationLabel?: (n: string, text: string) => string;
  /** Set when the answer can open its project: HTML pages get a button with this name. */
  previewLabel?: string;
}

interface RenderEnv extends Env {
  opts: RenderOptions;
}

function attr(token: Token, name: string): string {
  return String(token.attrGet(name) ?? '');
}

const LINK_REL = 'noopener noreferrer nofollow';
const SAFE_LINK = /^(?:https?:|mailto:)/i;
const DIR_AUTO_TOKENS = new Set([
  'paragraph_open',
  'heading_open',
  'list_item_open',
  'blockquote_open',
  'bullet_list_open',
  'ordered_list_open',
  'th_open',
  'td_open',
]);

const md = new MarkdownIt('default', { html: false, linkify: true, breaks: false });
const { escapeHtml } = md.utils;
// Unsafe schemes are decided by `markTokens` below, so a rejected link keeps its label as text
// instead of printing the whole `[label](javascript:...)` source back at the reader.
md.validateLink = () => true;

/** Core rule: decide each link's fate and give block elements `dir="auto"`. */
function markTokens(state: StateCore): void {
  const env = state.env as RenderEnv;
  for (const block of state.tokens) {
    if (DIR_AUTO_TOKENS.has(block.type)) block.attrSet('dir', 'auto');
    if (block.type !== 'inline' || !block.children) continue;

    const open: Token[] = [];
    for (const token of block.children) {
      if (token.type === 'link_open') {
        const href = attr(token, 'href');
        if (SAFE_LINK.test(href)) {
          token.attrSet('target', '_blank');
          token.attrSet('rel', LINK_REL);
          const mark = env.opts.linkClass?.(href);
          if (mark) {
            token.attrJoin('class', mark.className);
            for (const [name, value] of Object.entries(mark.attrs)) token.attrSet(name, value);
          }
        } else {
          token.meta = { drop: true };
        }
        open.push(token);
      } else if (token.type === 'link_close') {
        if (open.pop()?.meta?.drop) token.meta = { drop: true };
      }
    }
  }
}
md.core.ruler.push('neotext_marks', markTokens);

const defaultRule: RendererRule = (tokens, idx, options, _env, self) =>
  self.renderToken(tokens, idx, options);

for (const type of ['link_open', 'link_close'] as const) {
  const original = md.renderer.rules[type] ?? defaultRule;
  md.renderer.rules[type] = (tokens, idx, options, env, self) =>
    tokens[idx]?.meta?.drop ? '' : original(tokens, idx, options, env, self);
}

function languageOf(info: string): string {
  const word = info.trim().split(/\s+/, 1)[0] ?? '';
  return /^[\w+#.-]{1,32}$/.test(word) ? word : '';
}

/** A full HTML document, or a block named as an .html file, can open in the preview. */
function previewable(lang: string, info: string, content: string): boolean {
  if (lang !== 'html' && lang !== 'htm') return false;
  return (
    /<!doctype\s+html|<html[\s>]/i.test(content) || /\S\.html?\b/i.test(info.slice(lang.length))
  );
}

md.renderer.rules.fence = (tokens, idx, _options, env) => {
  const token = tokens[idx];
  if (!token) return '';
  const { opts } = env as RenderEnv;
  const lang = languageOf(token.info);
  const label = escapeHtml(lang);
  const cls = lang ? ` class="language-${label}"` : '';
  const preview =
    opts.previewLabel && previewable(lang, token.info, token.content)
      ? `<button type="button" class="md-preview" data-preview>${escapeHtml(opts.previewLabel)}</button>`
      : '';
  return (
    `<div class="md-code" dir="auto" data-lang="${label}"><div class="md-code-bar"><span>${label}</span>${preview}` +
    // An icon button: the icon is drawn in CSS, the hidden text names it and says when it copied.
    `<button type="button" data-copy title="${escapeHtml(opts.copyLabel)}">` +
    `<span class="md-sr" aria-live="polite">${escapeHtml(opts.copyLabel)}</span></button></div>` +
    `<pre><code${cls}>${escapeHtml(token.content)}</code></pre></div>`
  );
};

md.renderer.rules.code_block = (tokens, idx, options, env, self) =>
  md.renderer.rules.fence?.(tokens, idx, options, env, self) ?? '';

md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (!token) return '';
  const { opts } = env as RenderEnv;
  const alt = self.renderInlineAsText(token.children ?? [], options, env);
  const src = attr(token, 'src');
  let host = '';
  try {
    const url = new URL(src);
    if (url.protocol === 'https:') host = url.hostname;
  } catch {
    // not an absolute URL: falls through to alt text
  }
  if (!host) return escapeHtml(alt);
  return (
    `<button type="button" class="md-load-image" data-image-url="${escapeHtml(src)}" ` +
    `data-image-alt="${escapeHtml(alt)}">${escapeHtml(opts.loadImageLabel(host))}</button>`
  );
};

// markdown-it emits <s> for ~~text~~; the sanitizer's allowlist (and the design) uses <del>.
md.renderer.rules.s_open = () => '<del>';
md.renderer.rules.s_close = () => '</del>';

md.renderer.rules.table_open = () => '<div class="md-table" dir="auto"><table dir="auto">\n';
md.renderer.rules.table_close = () => '</table></div>\n';

let mathApplied = false;

/** Renders one markdown block to safe HTML wrapped in `<div dir="auto">`. */
export function renderBlock(block: string, opts: RenderOptions): string {
  if (!mathApplied) mathApplied = applyMath(md);
  const env: RenderEnv = { opts };
  return `<div dir="auto">${sanitizeHtml(md.render(block, env))}</div>`;
}
