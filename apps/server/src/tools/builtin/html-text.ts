import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

type ReaderDocument = ConstructorParameters<typeof Readability>[0];

/** Never page content, wherever they sit. */
const HIDDEN = 'head, title, script, style, noscript, template, svg';
/** Page furniture; dropped unless nothing else is left. */
const FURNITURE = 'nav, header, footer, aside';

/**
 * What text runs together without: `textContent` joins `<p>a</p><p>b</p>` as "ab", so each
 * block is followed by a blank line, a newline or (cells) a space.
 */
const SEPARATORS: Record<string, string> = {
  ...Object.fromEntries(
    'p h1 h2 h3 h4 h5 h6 blockquote pre ul ol table'.split(' ').map((tag) => [tag, '\n\n']),
  ),
  ...Object.fromEntries(
    'div li br tr section article dd dt figcaption main details figure address header footer nav aside'
      .split(' ')
      .map((tag) => [tag, '\n']),
  ),
  td: ' ',
  th: ' ',
};
const BLOCKS = Object.keys(SEPARATORS).join(', ');

/** The longest title kept. */
const TITLE_MAX = 300;

/** One line, no forged headers: all whitespace collapsed and the length capped. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);

/** Trims lines, collapses runs of spaces and keeps at most one blank line in a row. */
function tidy(text: string): string {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type Doc = ReturnType<typeof parseHTML>['document'];

/**
 * Markup written without `<html>` (omitting the optional html, head and body tags is valid)
 * is wrapped in a full document first, because linkedom does not add the implied elements and
 * would otherwise lose the content after the first one. Only an `<html` that opens the
 * document counts, after whitespace, comments, an XML prolog and the doctype: one inside a
 * script, comment, attribute or textarea does not.
 *
 * Each comment and prolog stops at its first terminator. With a lazy `[\s\S]*?` one could also
 * span several, and a failed match would then try 2^N ways to split N of them.
 */
const OPENS_WITH_HTML =
  /^(?:\s|<!--(?:(?!-->)[\s\S])*-->|<\?xml(?:(?!\?>)[\s\S])*\?>|<!doctype[^>]*>)*<html[\s>]/i;

export function wholeDocument(html: string): string {
  if (OPENS_WITH_HTML.test(html)) return html;
  return `<html><body>${html.replace(/^\s*<!doctype[^>]*>/i, '')}</body></html>`;
}

function parse(html: string, url: string): Doc {
  const { document } = parseHTML(wholeDocument(html));
  // Readability resolves links against these; linkedom does not set them from the input.
  for (const key of ['baseURI', 'documentURI']) {
    Object.defineProperty(document, key, { value: url, configurable: true });
  }
  return document;
}

/** Marks where blocks end, so that the text keeps its paragraphs and lines. */
function markBlocks(document: Doc): void {
  for (const el of document.querySelectorAll(BLOCKS)) {
    el.after(document.createTextNode(SEPARATORS[el.localName] ?? '\n'));
  }
}

function bodyText(document: Doc): string {
  for (const el of document.querySelectorAll(HIDDEN)) el.remove();
  markBlocks(document);
  // linkedom's `body` is unreliable for fragments, so read from the root.
  const everything = tidy(document.documentElement?.textContent ?? '');
  // A page made only of header or nav elements is still a page.
  for (const el of document.querySelectorAll(FURNITURE)) el.remove();
  return tidy(document.documentElement?.textContent ?? '') || everything;
}

/**
 * The readable text of an HTML page. linkedom builds a DOM without running scripts or loading
 * anything the markup points to; Readability picks the main article, and a page it cannot
 * find one in falls back to the body text. The result is plain text, never markup.
 */
export function htmlToText(html: string, url: string): { title: string; text: string } {
  if (!html.trim()) return { title: '', text: '' };
  const readable = parse(html, url);
  const title = oneLine(readable.querySelector('title')?.textContent ?? '');
  try {
    for (const el of readable.querySelectorAll('title')) el.remove();
    markBlocks(readable);
    const article = new Readability(readable as unknown as ReaderDocument).parse();
    const text = tidy(article?.textContent ?? '');
    if (text) return { title: oneLine(article?.title ?? '') || title, text };
  } catch {
    // Fall through to the plain body text.
  }
  // Readability changes the document it reads, so the fallback starts from a fresh one.
  return { title, text: bodyText(parse(html, url)) };
}
