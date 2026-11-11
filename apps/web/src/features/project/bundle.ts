import type { ProjectFiles } from '@neotext/shared';

export type Ref =
  | { kind: 'file'; path: string }
  | { kind: 'missing'; path: string }
  | { kind: 'external'; url: string }
  | { kind: 'keep' };

const isHtml = (path: string) => /\.html?$/i.test(path);
const folderOf = (path: string) => path.split('/').slice(0, -1).join('/');

/** The project's pages, the root `index.html` first, then by path. */
export function htmlPages(files: ProjectFiles): string[] {
  return [...files.keys()]
    .filter(isHtml)
    .sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a < b ? -1 : 1));
}

/**
 * What a reference in a file inside `folder` points at. Paths stay inside the project: one that
 * climbs above its root is missing. `/x` is the project root, as on a static site.
 */
export function resolveRef(folder: string, raw: string): Ref {
  const ref = raw.trim();
  if (ref === '' || ref.startsWith('#')) return { kind: 'keep' };
  if (/^(https?:)?\/\//i.test(ref)) return { kind: 'external', url: ref };
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return { kind: 'keep' };
  const clean = ref.split(/[?#]/)[0] ?? '';
  const parts = clean.startsWith('/') ? [] : folder.split('/').filter(Boolean);
  for (const segment of clean.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') parts.push(segment);
    else if (parts.length === 0) return { kind: 'missing', path: ref };
    else parts.pop();
  }
  return { kind: 'file', path: parts.join('/') };
}

const MIME: Record<string, string> = {
  svg: 'image/svg+xml',
  json: 'application/json',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  html: 'text/html',
  htm: 'text/html',
};

function dataUri(path: string, content: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return `data:${MIME[ext] ?? 'text/plain'};charset=utf-8,${encodeURIComponent(content)}`;
}

/** Keeps `</script` inside script text from ending the element. */
const scriptText = (code: string) => code.replace(/<\/(script)/gi, '<\\/$1');

/**
 * A JavaScript file put inline: also `<!--` when `<script` follows it somewhere, which makes the
 * parser read on past the element's own `</script>`. In JS strings `\!` is `!`. Scripts already
 * inline in the page went through that parse once, so they are left as they are.
 */
const inlinedFile = (code: string) =>
  /<!--[\s\S]*<script/i.test(code)
    ? scriptText(code).replaceAll('<!--', '<\\!--')
    : scriptText(code);

/** Keeps `</style` inside CSS from ending the style element; `\/` is `/` in CSS too. */
const styleText = (css: string) => css.replace(/<\/(style)/gi, '<\\/$1');

const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\2/g;
const moduleId = (path: string) => `@nt/${path}`;

interface Collected {
  files: ProjectFiles;
  missing: Set<string>;
  external: Set<string>;
  modules: Map<string, string>;
}

function note(out: Collected, ref: Ref, raw: string): void {
  if (ref.kind === 'external') out.external.add(ref.url);
  else if (ref.kind === 'missing' || (ref.kind === 'file' && !out.files.has(ref.path))) {
    out.missing.add(raw);
  }
}

/** Points the relative imports of module code at their import map ids, collecting each module. */
function rewriteImports(out: Collected, folder: string, code: string): string {
  return code.replace(SPECIFIER, (whole, lead: string, quote: string, spec: string) => {
    if (!/^(\.{1,2}\/|\/|https?:|\/\/)/i.test(spec)) return whole;
    const ref = resolveRef(folder, spec);
    if (ref.kind !== 'file' || !out.files.has(ref.path)) {
      note(out, ref, spec);
      return whole;
    }
    addModule(out, ref.path);
    return `${lead}${quote}${moduleId(ref.path)}${quote}`;
  });
}

function addModule(out: Collected, path: string): void {
  if (out.modules.has(path)) return;
  out.modules.set(path, ''); // Marks it first, so an import cycle stops here.
  const code = rewriteImports(out, folderOf(path), out.files.get(path) ?? '');
  out.modules.set(path, dataUri(path, code));
}

const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

function inlineCss(out: Collected, folder: string, css: string): string {
  return css.replace(CSS_URL, (whole, _quote: string, raw: string) => {
    const ref = resolveRef(folder, raw);
    if (ref.kind === 'file' && out.files.has(ref.path)) {
      return `url("${dataUri(ref.path, out.files.get(ref.path) ?? '')}")`;
    }
    note(out, ref, raw);
    return whole;
  });
}

const MEDIA =
  'img[src], source[src], audio[src], video[src], video[poster], input[type="image"][src]';

/** The project file `raw` points at from `folder`; otherwise notes it and gives null. */
function projectFile(out: Collected, folder: string, raw: string): string | null {
  const ref = resolveRef(folder, raw);
  if (ref.kind === 'file' && out.files.has(ref.path)) return ref.path;
  note(out, ref, raw);
  return null;
}

function inlineElement(out: Collected, doc: Document, folder: string, el: Element): void {
  const tag = el.tagName.toLowerCase();
  if (tag === 'link') {
    const path = projectFile(out, folder, el.getAttribute('href') ?? '');
    if (path === null) return;
    const style = doc.createElement('style');
    style.textContent = inlineCss(out, folderOf(path), out.files.get(path) ?? '');
    el.replaceWith(style);
  } else if (tag === 'script') {
    const path = projectFile(out, folder, el.getAttribute('src') ?? '');
    if (path === null) return;
    el.removeAttribute('src');
    if (el.getAttribute('type') === 'module') {
      addModule(out, path);
      el.textContent = `import '${moduleId(path)}';`;
    } else if (el.hasAttribute('defer') || el.hasAttribute('async')) {
      // An inline script ignores defer and async, so it would run before the page below it.
      el.setAttribute('src', dataUri(path, out.files.get(path) ?? ''));
    } else {
      el.textContent = inlinedFile(out.files.get(path) ?? '');
    }
  } else {
    const attr = el.hasAttribute('poster') && tag === 'video' ? 'poster' : 'src';
    const path = projectFile(out, folder, el.getAttribute(attr) ?? '');
    if (path === null) return;
    el.setAttribute(attr, dataUri(path, out.files.get(path) ?? ''));
  }
}

const HINTS = ['dns-prefetch', 'preconnect', 'prefetch', 'preload', 'modulepreload', 'prerender']
  .map((rel) => `link[rel~="${rel}"]`)
  .join(', ');

function headScript(doc: Document, text: string, attrs: Record<string, string> = {}) {
  const script = doc.createElement('script');
  for (const [name, value] of Object.entries(attrs)) script.setAttribute(name, value);
  script.textContent = text;
  return script;
}

export interface BundleOptions {
  /** The in-page runtime; null for a download, which also leaves out the storage seed. */
  prelude: string | null;
  storage: Record<string, string>;
}

export interface Bundle {
  html: string;
  /** Project paths referenced but not in the project. */
  missing: string[];
  /** Outside URLs, which the offline preview will not load. */
  external: string[];
}

/** Joins `entry` and the files it uses into one self-contained page. */
export function bundlePage(files: ProjectFiles, entry: string, opts: BundleOptions): Bundle {
  const out: Collected = { files, missing: new Set(), external: new Set(), modules: new Map() };
  const doc = new DOMParser().parseFromString(files.get(entry) ?? '', 'text/html');
  const folder = folderOf(entry);
  // Resource hints resolve names before any CSP check, so they go before anything else.
  for (const hint of doc.querySelectorAll(HINTS)) {
    note(out, resolveRef(folder, hint.getAttribute('href') ?? ''), hint.getAttribute('href') ?? '');
    hint.remove();
  }
  const selector = `link[rel~="stylesheet"][href], script[src], ${MEDIA}`;
  for (const el of [...doc.querySelectorAll(selector)]) inlineElement(out, doc, folder, el);
  for (const style of doc.querySelectorAll('style')) {
    style.textContent = styleText(inlineCss(out, folder, style.textContent ?? ''));
  }
  for (const el of doc.querySelectorAll('[style]')) {
    el.setAttribute('style', inlineCss(out, folder, el.getAttribute('style') ?? ''));
  }
  for (const script of doc.querySelectorAll('script[type="module"]:not([src])')) {
    script.textContent = scriptText(rewriteImports(out, folder, script.textContent ?? ''));
  }
  for (const script of doc.querySelectorAll('script:not([type="module"]):not([src])')) {
    script.textContent = scriptText(script.textContent ?? '');
  }

  const first: HTMLScriptElement[] = [];
  if (opts.prelude !== null) {
    const seed = JSON.stringify(opts.storage).replaceAll('<', '\\u003c');
    first.push(headScript(doc, seed, { type: 'application/json', id: '__nt_storage' }));
    first.push(headScript(doc, opts.prelude));
  }
  if (out.modules.size > 0) {
    const imports = Object.fromEntries([...out.modules].map(([p, uri]) => [moduleId(p), uri]));
    first.push(headScript(doc, JSON.stringify({ imports }), { type: 'importmap' }));
  }
  doc.head.prepend(...first);
  return {
    html: `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`,
    missing: [...out.missing],
    external: [...out.external],
  };
}
