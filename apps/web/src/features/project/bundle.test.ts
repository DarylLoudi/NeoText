import { describe, expect, it } from 'vitest';
import { bundlePage, htmlPages, resolveRef } from './bundle';

const files = (entries: Record<string, string>) => new Map(Object.entries(entries));
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const PRELUDE = 'window.__prelude = 1;';

function bundle(
  entries: Record<string, string>,
  entry = 'index.html',
  opts: { prelude?: string | null; storage?: Record<string, string> } = {},
) {
  const out = bundlePage(files(entries), entry, {
    prelude: opts.prelude === undefined ? PRELUDE : opts.prelude,
    storage: opts.storage ?? {},
  });
  return { ...out, doc: parse(out.html) };
}

describe('htmlPages', () => {
  it('lists html pages with the root index first', () => {
    const pages = htmlPages(
      files({ 'b.html': '', 'pages/index.html': '', 'index.html': '', 'a.htm': '', 'x.css': '' }),
    );
    expect(pages).toEqual(['index.html', 'a.htm', 'b.html', 'pages/index.html']);
  });
});

describe('resolveRef', () => {
  it('joins relative paths and leaves the project root closed', () => {
    expect(resolveRef('pages', '../css/a.css')).toEqual({ kind: 'file', path: 'css/a.css' });
    expect(resolveRef('', './a.css?v=2#x')).toEqual({ kind: 'file', path: 'a.css' });
    expect(resolveRef('', '/a.css')).toEqual({ kind: 'file', path: 'a.css' });
    expect(resolveRef('', '../../a.css')).toEqual({ kind: 'missing', path: '../../a.css' });
    expect(resolveRef('', 'https://cdn.x/y.js')).toEqual({
      kind: 'external',
      url: 'https://cdn.x/y.js',
    });
    expect(resolveRef('', '//cdn.x/y.js')).toEqual({ kind: 'external', url: '//cdn.x/y.js' });
    expect(resolveRef('', 'data:image/png;base64,AA')).toEqual({ kind: 'keep' });
    expect(resolveRef('', '#top')).toEqual({ kind: 'keep' });
  });
});

describe('bundlePage', () => {
  it('runs the prelude before anything else, then the storage seed', () => {
    const { doc } = bundle({ 'index.html': '<!doctype html><title>t</title><p>a</p>' });
    const scripts = [...doc.head.querySelectorAll('script')];
    expect(scripts[0]?.id).toBe('__nt_storage');
    expect(scripts[1]?.textContent).toBe(PRELUDE);
  });

  it('adds a head to a page without one', () => {
    const { doc } = bundle({ 'index.html': '<p>only a fragment</p>' });
    expect(doc.head.querySelector('script')).not.toBeNull();
    expect(doc.body.textContent).toContain('only a fragment');
  });

  it('inlines stylesheets and classic scripts resolved from the page folder', () => {
    const { doc, missing, external } = bundle(
      {
        'pages/about.html':
          '<html><head><link rel="stylesheet" href="../css/a.css"></head><body><script src="../js/app.js"></script></body></html>',
        'css/a.css': 'p{color:red}',
        'js/app.js': 'document.title = "</script><b>"',
      },
      'pages/about.html',
    );
    expect(doc.querySelector('link')).toBeNull();
    expect(doc.querySelector('style')?.textContent).toBe('p{color:red}');
    const script = [...doc.body.querySelectorAll('script')].at(-1);
    expect(script?.getAttribute('src')).toBeNull();
    expect(script?.textContent).toBe('document.title = "<\\/script><b>"');
    expect(missing).toEqual([]);
    expect(external).toEqual([]);
  });

  it('lists outside and missing references and leaves them in place', () => {
    const { doc, missing, external } = bundle({
      'index.html':
        '<link rel="stylesheet" href="https://cdn.example/b.css"><script src="nope.js"></script><img src="logo.svg"><img src="https://img.example/x.png">',
    });
    expect(external).toEqual(['https://cdn.example/b.css', 'https://img.example/x.png']);
    expect(missing).toEqual(['nope.js', 'logo.svg']);
    expect(doc.querySelector('link')?.getAttribute('href')).toBe('https://cdn.example/b.css');
  });

  it('turns project images and css url() into data URIs', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const { doc } = bundle({
      'index.html': '<link rel="stylesheet" href="s.css"><img src="img/logo.svg">',
      's.css': 'body{background:url("img/logo.svg")}',
      'img/logo.svg': svg,
    });
    const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    expect(doc.querySelector('img')?.getAttribute('src')).toBe(uri);
    expect(doc.querySelector('style')?.textContent).toBe(`body{background:url("${uri}")}`);
  });

  it('wires module scripts and their imports through an import map', () => {
    const { doc } = bundle({
      'index.html': '<script type="module" src="js/main.js"></script>',
      'js/main.js':
        "import { add } from './util.js';\nimport('./lazy.js');\nconsole.log(add(1, 2));",
      'js/util.js': "export * from '../lib/math.js';",
      'lib/math.js': 'export const add = (a, b) => a + b;',
      'js/lazy.js': 'export default 1;',
    });
    const map = JSON.parse(doc.querySelector('script[type="importmap"]')?.textContent ?? '{}') as {
      imports: Record<string, string>;
    };
    expect(Object.keys(map.imports).sort()).toEqual([
      '@nt/js/lazy.js',
      '@nt/js/main.js',
      '@nt/js/util.js',
      '@nt/lib/math.js',
    ]);
    const main = decodeURIComponent(
      (map.imports['@nt/js/main.js'] ?? '').replace('data:text/javascript;charset=utf-8,', ''),
    );
    expect(main).toContain("from '@nt/js/util.js'");
    expect(main).toContain("import('@nt/js/lazy.js')");
    const entry = [...doc.querySelectorAll('script[type="module"]')].at(-1);
    expect(entry?.textContent).toBe("import '@nt/js/main.js';");
    // The map comes before the first module.
    const all = [...doc.querySelectorAll('script')];
    expect(
      all.indexOf(doc.querySelector('script[type="importmap"]') as HTMLScriptElement),
    ).toBeLessThan(all.indexOf(entry as HTMLScriptElement));
  });

  it('keeps defer and async on scripts, loading them from data URIs', () => {
    const { doc } = bundle({
      'index.html': '<head><script src="app.js" defer></script></head><body><p id="x"></p></body>',
      'app.js': 'document.getElementById("x").textContent = "ok";',
    });
    const script = doc.head.querySelector('script[defer]');
    expect(script?.getAttribute('src')?.startsWith('data:text/javascript')).toBe(true);
    expect(decodeURIComponent(script?.getAttribute('src') ?? '')).toContain('textContent = "ok"');
  });

  it('drops hints that would resolve outside names before the CSP can stop them', () => {
    const { doc, external } = bundle({
      'index.html':
        '<link rel="dns-prefetch" href="//leak.example"><link rel="preconnect" href="https://leak.example"><link rel="prefetch" href="https://leak.example/x"><p>a</p>',
    });
    expect(doc.querySelectorAll('link')).toHaveLength(0);
    expect(external).toContain('//leak.example');
  });

  it('escapes the storage seed so a value cannot end its script', () => {
    const { doc } = bundle({ 'index.html': '<p>a</p>' }, 'index.html', {
      storage: { note: '</script><img src=x onerror=alert(1)>' },
    });
    const seed = doc.getElementById('__nt_storage');
    expect(JSON.parse(seed?.textContent ?? '')).toEqual({
      note: '</script><img src=x onerror=alert(1)>',
    });
    expect(doc.querySelectorAll('img')).toHaveLength(0);
  });

  it('leaves the prelude and storage out of a download', () => {
    const { html } = bundle({ 'index.html': '<p>a</p>' }, 'index.html', { prelude: null });
    expect(html).not.toContain(PRELUDE);
    expect(html).not.toContain('__nt_storage');
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  });

  it('keeps </style in a stylesheet from ending the style element', () => {
    const { doc } = bundle({
      'index.html': '<link rel="stylesheet" href="s.css"><p id="after">a</p>',
      's.css': 'p::after{content:"</style><b id=x>"}',
    });
    expect(doc.querySelectorAll('style')).toHaveLength(1);
    expect(doc.getElementById('x')).toBeNull();
    expect(doc.getElementById('after')).not.toBeNull();
  });

  it('keeps <!-- with <script in an inlined file from swallowing the rest of the page', () => {
    // A browser that meets `<!--` then `<script` in a script reads on past its `</script>`.
    const { html, doc } = bundle({
      'index.html': '<script src="a.js"></script><p>a</p>',
      'a.js': 'var s = "<!-- <script>"; var t = 1;',
    });
    expect(html).not.toContain('<!-- <script');
    const script = [...doc.querySelectorAll('script')].at(-1);
    // Same value once run: `\!` is just `!` in a string.
    expect(new Function(`${script?.textContent}; return s;`)()).toBe('<!-- <script>');
  });

  it('leaves <!-- alone where it cannot do that: data blocks, templates, files without <script', () => {
    const json = '{"tpl":"<!-- x -->"}';
    const { doc } = bundle({
      'index.html': `<script type="application/json" id="cfg">${json}</script><script type="text/template" id="tpl"><!-- row --><li>a</li></script><script src="b.js"></script>`,
      'b.js': 'var c = "<!-- just a comment marker";',
    });
    expect(doc.getElementById('cfg')?.textContent).toBe(json);
    expect(doc.getElementById('tpl')?.textContent).toBe('<!-- row --><li>a</li>');
    expect([...doc.querySelectorAll('script')].at(-1)?.textContent).toBe(
      'var c = "<!-- just a comment marker";',
    );
  });
});
