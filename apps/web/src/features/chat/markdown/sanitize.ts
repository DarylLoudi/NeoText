import DOMPurify from 'dompurify';

const TAGS = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'span',
  'a',
  'strong',
  'em',
  'del',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'hr',
  'br',
  'div',
  'button',
  'sup',
  'sub',
];
const ATTRS = ['href', 'title', 'class', 'target', 'rel', 'dir', 'type'];
const LINK_REL = 'noopener noreferrer nofollow';

/** Inline styles can fetch resources or cover the page; these never belong in a safe style. */
const UNSAFE_STYLE =
  /url\(|expression|@import|javascript:|behavior|\\|\/\*|position\s*:\s*(?:fixed|sticky)/i;

/**
 * KaTeX draws radicals, arrows, braces and cancel strokes with inline SVG. Only these three
 * shapes, with only these attributes, and only inside KaTeX output, are ever allowed.
 */
const SVG_ATTRS: Record<string, readonly string[]> = {
  svg: ['width', 'height', 'viewbox', 'preserveaspectratio', 'xmlns'],
  path: ['d'],
  line: ['x1', 'x2', 'y1', 'y2'],
};
const SVG_TAGS = Object.keys(SVG_ATTRS);

function hasActiveAttribute(el: Element): boolean {
  return el.getAttributeNames().some((name) => /^on|href/i.test(name));
}

/** An svg is accepted whole or not at all: only path/line children, nothing scripted or linked. */
function isPlainKatexSvg(svg: Element): boolean {
  if (
    !svg.parentElement?.closest('.katex') ||
    svg.parentElement?.closest('svg') ||
    hasActiveAttribute(svg)
  ) {
    return false;
  }
  return [...svg.querySelectorAll('*')].every(
    (el) => ['path', 'line'].includes(el.tagName.toLowerCase()) && !hasActiveAttribute(el),
  );
}

function isAllowedSvgNode(node: Element, tag: string): boolean {
  if (tag === 'svg') return isPlainKatexSvg(node);
  const parent = node.parentElement;
  return parent?.tagName.toLowerCase() === 'svg' && isPlainKatexSvg(parent);
}

function createPurifier(styleRoot: string, allowKatexSvg: boolean) {
  const purifier = DOMPurify(window);

  if (allowKatexSvg) {
    // DOMPurify decides tag by tag from `allowedTags`; the allowlist includes the svg tags and
    // this hook switches them off for every node that is not plain KaTeX output.
    purifier.addHook('uponSanitizeElement', (node, data) => {
      if (node instanceof Element && SVG_TAGS.includes(data.tagName)) {
        data.allowedTags[data.tagName] = isAllowedSvgNode(node, data.tagName);
      }
    });
  }

  purifier.addHook('uponSanitizeAttribute', (node, data) => {
    const name = data.attrName.toLowerCase();
    if (allowKatexSvg && SVG_ATTRS[node.tagName.toLowerCase()]?.includes(name)) {
      data.forceKeepAttr = true;
      return;
    }
    if (name !== 'style') return;
    if (UNSAFE_STYLE.test(data.attrValue)) return;
    if (node.closest(styleRoot)) data.forceKeepAttr = true;
  });

  purifier.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName !== 'A') return;
    if (node.hasAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', LINK_REL);
    } else {
      node.removeAttribute('target');
      node.removeAttribute('rel');
    }
  });

  return purifier;
}

// Both instances are created lazily so that importing this file never needs a DOM.
let messagePurifier: ReturnType<typeof createPurifier> | undefined;
let codePurifier: ReturnType<typeof createPurifier> | undefined;

/**
 * Sanitizes rendered markdown. Only http, https and mailto links survive, no event handlers, and
 * `style` is kept only inside KaTeX output (`.katex`), where the renderer needs it for layout.
 */
export function sanitizeHtml(html: string): string {
  messagePurifier ??= createPurifier('.katex', true);
  return messagePurifier.sanitize(html, {
    ALLOWED_TAGS: [...TAGS, ...SVG_TAGS],
    ALLOWED_ATTR: ATTRS,
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
    ADD_URI_SAFE_ATTR: ['target', 'rel', 'dir', 'type'],
    ALLOW_DATA_ATTR: true,
    ALLOW_ARIA_ATTR: true,
  });
}

/** Sanitizes Shiki output: code, spans and the colors Shiki puts in `style` (inside `.shiki`). */
export function sanitizeHighlightedHtml(html: string): string {
  codePurifier ??= createPurifier('.shiki', false);
  return codePurifier.sanitize(html, {
    ALLOWED_TAGS: ['pre', 'code', 'span'],
    ALLOWED_ATTR: ['class'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}
