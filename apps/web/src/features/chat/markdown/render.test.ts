// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { type RenderOptions, renderBlock } from './render';

const opts: RenderOptions = {
  copyLabel: 'Copy',
  loadImageLabel: (host) => `Load image from ${host}`,
};

function parse(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

/** Model output may show HTML as literal text, but it must never become live markup. */
function expectInert(out: string): void {
  const root = parse(out);
  expect(out).not.toMatch(/<script|<iframe/);
  expect(root.querySelector('script,iframe,svg,img,object,embed,style,form,input')).toBeNull();
  for (const el of root.querySelectorAll('*')) {
    expect(el.getAttributeNames().filter((n) => n.startsWith('on'))).toEqual([]);
    expect(el.hasAttribute('style')).toBe(false);
    expect(el.getAttribute('href') ?? '').not.toMatch(/^\s*(javascript|data|vbscript):/i);
  }
}

describe('hostile model output', () => {
  test.each([
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg onload=alert(1)>',
    '<iframe src="https://x.org"></iframe>',
    '[click](javascript:alert(1))',
    '[click](data:text/html;base64,AAAA)',
    '[click](JaVaScRiPt:alert(1))',
    '[click](  javascript:alert(1))',
    '<a href="vbscript:x">v</a>',
    '<div style="position:fixed">x</div>',
    '<https://x.org/"onmouseover="alert(1)>',
    '[x](https://x.org "t\\" onmouseover=\\"alert(1)")',
    '![x](javascript:alert(1))',
    '![x](data:image/svg+xml;base64,AAAA)',
    '```html\n<script>alert(1)</script>\n```',
    '`<img src=x onerror=alert(1)>`',
    '| <img src=x onerror=1> |\n|---|\n| x |',
  ])('neutralizes %s', (src) => {
    expectInert(renderBlock(src, opts));
  });

  test('a link with a dangerous scheme renders as its label only', () => {
    const out = renderBlock(
      '[click](javascript:alert(1)) and [d](data:text/html;base64,AAAA)',
      opts,
    );
    expect(out).not.toContain('<a');
    expect(out).not.toMatch(/javascript:|data:text/);
    expect(out).toContain('click');
  });

  test('raw HTML is shown as text, not parsed', () => {
    const out = renderBlock('<b>hi</b>', opts);
    expect(parse(out).querySelector('b')).toBeNull();
    expect(parse(out).textContent).toContain('<b>hi</b>');
  });
});

describe('links', () => {
  test('open safely', () => {
    expect(renderBlock('[a](https://x.org)', opts)).toMatch(
      /target="_blank"[^>]*rel="noopener noreferrer nofollow"/,
    );
  });

  test('autolinked bare URLs and emails are hardened too', () => {
    const root = parse(renderBlock('see https://x.org/a and me@x.org', opts));
    const anchors = [...root.querySelectorAll('a')];
    expect(anchors.map((a) => a.getAttribute('href'))).toEqual([
      'https://x.org/a',
      'mailto:me@x.org',
    ]);
    for (const a of anchors) expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow');
  });

  test('ftp and relative links render as text', () => {
    const out = renderBlock('[a](ftp://x.org) [b](/rel) [c](#frag)', opts);
    expect(out).not.toContain('<a');
  });

  test('linkClass can mark citations', () => {
    const out = renderBlock('[1](https://x.org)', {
      ...opts,
      linkClass: (href) =>
        href === 'https://x.org' ? { className: 'cite', attrs: { 'data-cite': '1' } } : null,
    });
    const a = parse(out).querySelector('a');
    expect(a?.classList.contains('cite')).toBe(true);
    expect(a?.getAttribute('data-cite')).toBe('1');
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer nofollow');
  });
});

describe('images', () => {
  test('remote images never load by themselves', () => {
    const out = renderBlock('![cat](https://evil.example/p.png?secret=1)', opts);
    expect(out).not.toContain('<img');
    expect(out).toContain('data-image-url="https://evil.example/p.png?secret=1"');
    const button = parse(out).querySelector('button.md-load-image');
    expect(button?.getAttribute('type')).toBe('button');
    expect(button?.getAttribute('data-image-alt')).toBe('cat');
    expect(button?.textContent).toBe('Load image from evil.example');
  });

  test('http and data images become alt text', () => {
    for (const src of ['http://x.org/a.png', 'data:image/png;base64,AAAA', '/local.png']) {
      const out = renderBlock(`![the alt](${src})`, opts);
      expect(out).not.toContain('<img');
      expect(out).not.toContain('md-load-image');
      expect(parse(out).textContent).toContain('the alt');
    }
  });
});

describe('structure', () => {
  test('blocks use dir auto', () => {
    expect(renderBlock('مرحبا', opts)).toContain('dir="auto"');
    expect(renderBlock('مرحبا', opts).startsWith('<div dir="auto">')).toBe(true);
  });

  test('each paragraph, heading, list item and cell carries dir auto', () => {
    const root = parse(renderBlock('# h\n\n- a\n- b\n\n> q\n\n| a |\n|---|\n| 1 |', opts));
    const missing = [...root.querySelectorAll('h1,p,li,blockquote,th,td')].filter(
      (el) => el.getAttribute('dir') !== 'auto',
    );
    expect(missing).toEqual([]);
  });

  test('lists, tables and code cards carry dir auto on their wrappers', () => {
    const list = parse(renderBlock('- a\n- b\n\n1. c', opts));
    expect(list.querySelector('ul')?.getAttribute('dir')).toBe('auto');
    expect(list.querySelector('ol')?.getAttribute('dir')).toBe('auto');
    const table = parse(renderBlock('| a |\n|---|\n| 1 |', opts));
    expect(table.querySelector('.md-table')?.getAttribute('dir')).toBe('auto');
    expect(table.querySelector('table')?.getAttribute('dir')).toBe('auto');
    const code = parse(renderBlock('```ts\nx\n```', opts));
    expect(code.querySelector('.md-code')?.getAttribute('dir')).toBe('auto');
  });

  test('fences become a code card with a copy button', () => {
    const root = parse(renderBlock('```ts\nconst a = "<b>";\n```', opts));
    const card = root.querySelector('.md-code');
    expect(card?.getAttribute('data-lang')).toBe('ts');
    expect(card?.querySelector('.md-code-bar span')?.textContent).toBe('ts');
    const button = card?.querySelector('.md-code-bar button[data-copy]');
    expect(button?.getAttribute('type')).toBe('button');
    expect(button?.textContent).toBe('Copy');
    expect(button?.getAttribute('title')).toBe('Copy');
    expect(button?.querySelector('.md-sr')?.textContent).toBe('Copy');
    expect(button?.querySelector('.md-sr')?.getAttribute('aria-live')).toBe('polite');
    const code = card?.querySelector('pre > code.language-ts');
    expect(code?.textContent).toBe('const a = "<b>";\n');
    expect(card?.querySelector('b')).toBeNull();
  });

  test('a hostile info string cannot break out of the attributes', () => {
    expectInert(renderBlock('```"><img src=x onerror=alert(1)>\ncode\n```', opts));
  });

  test('fences without a language still render', () => {
    const card = parse(renderBlock('```\nx\n```', opts)).querySelector('.md-code');
    expect(card?.getAttribute('data-lang')).toBe('');
    expect(card?.querySelector('pre > code')?.textContent).toBe('x\n');
  });

  test('tables get a scroll wrapper', () => {
    const root = parse(renderBlock('| a | b |\n|---|---|\n| 1 | 2 |', opts));
    expect(root.querySelector('.md-table > table thead th')).not.toBeNull();
  });

  test('strikethrough, emphasis and inline code render', () => {
    const root = parse(renderBlock('~~gone~~ **bold** *em* `code`', opts));
    expect(root.querySelector('del')?.textContent).toBe('gone');
    expect(root.querySelector('strong')?.textContent).toBe('bold');
    expect(root.querySelector('em')?.textContent).toBe('em');
    expect(root.querySelector('code')?.textContent).toBe('code');
  });

  test('a single newline does not break the line', () => {
    expect(renderBlock('a\nb', opts)).not.toContain('<br');
  });
});
