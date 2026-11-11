import { normalizeProjectPath } from './paths';
import type { ProjectOp } from './types';

interface Block {
  info: string;
  body: string;
  /** Index of the opening fence line. */
  line: number;
}

const OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** Fenced blocks that close; an unclosed one (a cut-off stream) is left out. */
function fencedBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = OPEN.exec(lines[i] ?? '');
    if (!open) continue;
    const marker = open[1] ?? '```';
    const close = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`);
    const end = lines.findIndex((l, j) => j > i && close.test(l));
    if (end === -1) break;
    blocks.push({
      info: (open[2] ?? '').trim(),
      body: lines.slice(i + 1, end).join('\n'),
      line: i,
    });
    i = end;
  }
  return blocks;
}

const ATTRIBUTE = /^(?:title|filename|file)=["']?([^"']+)["']?$/i;

function nameFromInfo(info: string): string | null {
  const tokens = info.split(/\s+/).filter(Boolean);
  for (const token of tokens.slice(1)) {
    const attr = ATTRIBUTE.exec(token);
    const name = normalizeProjectPath(attr ? (attr[1] ?? '') : token);
    if (name) return name;
  }
  const first = tokens[0] ?? '';
  return first.includes('.') ? normalizeProjectPath(first) : null;
}

/** A line that is only a file name, dressed as a heading, bold, code or with a colon. */
function nameFromLine(line: string | undefined): string | null {
  if (line === undefined) return null;
  const bare = line
    .trim()
    .replace(/^#+\s*/, '')
    .replace(/:$/, '')
    .replace(/^[*_`]+|[*_`]+$/g, '')
    .replace(/:$/, '');
  return bare === '' || /\s/.test(bare) ? null : normalizeProjectPath(bare);
}

function nameBefore(lines: string[], at: number): string | null {
  const previous = lines[at - 1];
  if (previous !== undefined && previous.trim() === '') return nameFromLine(lines[at - 2]);
  return nameFromLine(previous);
}

const COMMENT = /^\s*(?:<!--\s*(\S+)\s*-->|\/\*\s*(\S+)\s*\*\/|\/\/\s*(\S+)\s*)$/;

function nameFromComment(body: string): string | null {
  const m = COMMENT.exec(body.split('\n', 1)[0] ?? '');
  const raw = m?.[1] ?? m?.[2] ?? m?.[3];
  return raw ? normalizeProjectPath(raw) : null;
}

const language = (info: string) => (info.split(/\s+/)[0] ?? '').toLowerCase();
const isHtml = (lang: string) => lang === 'html' || lang === 'htm';
const isCss = (lang: string) => lang === 'css';
const isJs = (lang: string) => lang === 'js' || lang === 'javascript' || lang === 'mjs';
const FULL_DOCUMENT = /<!doctype\s+html|<html[\s>]/i;

/** Inserts `tag` before the first `before` tag (any case), or at `fallback` when there is none. */
function insertBefore(html: string, before: string, tag: string, fallback: 'start' | 'end') {
  const at = html.toLowerCase().indexOf(before);
  if (at !== -1) return `${html.slice(0, at)}${tag}\n${html.slice(at)}`;
  return fallback === 'start' ? `${tag}\n${html}` : `${html}\n${tag}`;
}

const references = (html: string, file: string) =>
  new RegExp(`(?:href|src)\\s*=\\s*["']?(?:\\./)?${file.replace('.', '\\.')}`, 'i').test(html);

/**
 * The files a model without tools wrote as named code blocks, as write operations in text order.
 * An unnamed full HTML document is `index.html`; a lone unnamed CSS or JS block beside it becomes
 * `style.css` or `script.js` and is linked from the page when the page does not link it already.
 */
export function opsFromText(text: string): ProjectOp[] {
  const lines = text.split(/\r?\n/);
  const blocks = fencedBlocks(lines);
  const ops: { kind: 'write'; path: string; content: string }[] = [];
  const unnamed = { page: -1, css: [] as Block[], js: [] as Block[] };
  for (const block of blocks) {
    const lang = language(block.info);
    const name =
      nameFromInfo(block.info) ?? nameBefore(lines, block.line) ?? nameFromComment(block.body);
    if (name) {
      ops.push({ kind: 'write', path: name, content: block.body });
    } else if (isHtml(lang) && FULL_DOCUMENT.test(block.body) && unnamed.page === -1) {
      unnamed.page = ops.length;
      ops.push({ kind: 'write', path: 'index.html', content: block.body });
    } else if (isCss(lang)) unnamed.css.push(block);
    else if (isJs(lang)) unnamed.js.push(block);
  }
  const page = ops[unnamed.page];
  if (!page) return ops;
  if (unnamed.css.length === 1) {
    ops.push({ kind: 'write', path: 'style.css', content: unnamed.css[0]?.body ?? '' });
    if (!references(page.content, 'style.css')) {
      const link = '<link rel="stylesheet" href="style.css">';
      page.content = insertBefore(page.content, '</head>', link, 'start');
    }
  }
  if (unnamed.js.length === 1) {
    ops.push({ kind: 'write', path: 'script.js', content: unnamed.js[0]?.body ?? '' });
    if (!references(page.content, 'script.js')) {
      const script = '<script src="script.js"></script>';
      page.content = insertBefore(page.content, '</body>', script, 'end');
    }
  }
  return ops;
}
