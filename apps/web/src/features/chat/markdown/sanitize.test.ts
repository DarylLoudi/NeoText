// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { sanitizeHighlightedHtml, sanitizeHtml } from './sanitize';

function parse(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

describe('sanitizeHtml', () => {
  test.each([
    '<script>alert(1)</script><p>x</p>',
    '<img src=x onerror=alert(1)>',
    '<svg onload=alert(1)></svg>',
    '<iframe src="https://x.org"></iframe>',
    '<a href="javascript:alert(1)">x</a>',
    '<a href=" jav&#x09;ascript:alert(1)">x</a>',
    '<a href="data:text/html;base64,AAAA">x</a>',
    '<a href="vbscript:x">v</a>',
    '<p onclick="alert(1)">x</p>',
    '<div style="position:fixed;inset:0">x</div>',
    '<form action="https://evil.example"><input name=a></form>',
    '<object data="x"></object><embed src="x">',
    '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
    '<base href="https://evil.example">',
    '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  ])('neutralizes %s', (src) => {
    const root = parse(sanitizeHtml(src));
    expect(
      root.querySelector('script,iframe,svg,img,object,embed,form,input,style,base,meta,math'),
    ).toBeNull();
    for (const el of root.querySelectorAll('*')) {
      expect(el.getAttributeNames().filter((n) => n.startsWith('on'))).toEqual([]);
      expect(el.hasAttribute('style')).toBe(false);
      const href = el.getAttribute('href') ?? '';
      expect(href).not.toMatch(/^\s*(javascript|data|vbscript):/i);
    }
  });

  test('keeps only http, https and mailto links and hardens them', () => {
    const root = parse(
      sanitizeHtml(
        '<a href="https://x.org">a</a><a href="http://x.org">b</a><a href="mailto:a@b.co">c</a><a href="/rel">d</a><a href="ftp://x.org">e</a>',
      ),
    );
    const anchors = [...root.querySelectorAll('a')];
    expect(anchors.map((a) => a.getAttribute('href'))).toEqual([
      'https://x.org',
      'http://x.org',
      'mailto:a@b.co',
      null,
      null,
    ]);
    for (const a of anchors.slice(0, 3)) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    }
  });

  test('keeps the structure the renderer emits', () => {
    const html =
      '<div dir="auto"><div class="md-code" data-lang="ts"><div class="md-code-bar"><span>ts</span><button type="button" data-copy>Copy</button></div><pre><code class="language-ts">x</code></pre></div></div>';
    const out = parse(sanitizeHtml(html));
    expect(out.querySelector('button[type="button"][data-copy]')).not.toBeNull();
    expect(
      out.querySelector('div[dir="auto"] .md-code[data-lang="ts"] pre code.language-ts'),
    ).not.toBeNull();
  });

  test('style survives only inside .katex subtrees', () => {
    const out = parse(
      sanitizeHtml(
        '<span class="katex"><span class="strut" style="height:0.6em;vertical-align:-0.1em"></span></span><span class="other" style="color:red"></span>',
      ),
    );
    expect(out.querySelector('.strut')?.getAttribute('style')).toContain('height:0.6em');
    expect(out.querySelector('.other')?.hasAttribute('style')).toBe(false);
  });

  test('style inside .katex cannot load resources or escape the box', () => {
    const out = parse(
      sanitizeHtml(
        '<span class="katex"><span class="a" style="background:url(https://evil.example/x)"></span><span class="b" style="position:fixed"></span></span>',
      ),
    );
    expect(out.querySelector('.a')?.hasAttribute('style')).toBe(false);
    expect(out.querySelector('.b')?.hasAttribute('style')).toBe(false);
  });
});

describe('KaTeX svg', () => {
  const sqrt =
    '<span class="katex"><span class="hide-tail" style="min-width:0.742em;height:1.08em"><svg xmlns="http://www.w3.org/2000/svg" width="400em" height="1.08em" viewBox="0 0 400000 1080" preserveAspectRatio="xMinYMin slice" style="width:100%"><path d="M95 702l1 2"></path></svg></span></span>';

  test('svg, path and line survive inside .katex with only the allowed attributes', () => {
    const out = parse(sanitizeHtml(sqrt));
    const svg = out.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 400000 1080');
    expect(svg?.getAttribute('preserveAspectRatio')).toBe('xMinYMin slice');
    expect(svg?.getAttribute('width')).toBe('400em');
    expect(svg?.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
    expect(svg?.getAttribute('style')).toBe('width:100%');
    expect(out.querySelector('svg > path')?.getAttribute('d')).toBe('M95 702l1 2');

    const line = parse(
      sanitizeHtml(
        '<span class="katex"><svg width="1em" height="1em"><line x1="0" x2="1" y1="0" y2="1" fill="red" stroke="blue"></line></svg></span>',
      ),
    ).querySelector('line');
    expect(line?.getAttribute('x2')).toBe('1');
    expect(line?.getAttribute('y1')).toBe('0');
    expect(line?.hasAttribute('fill')).toBe(false);
    expect(line?.hasAttribute('stroke')).toBe(false);
  });

  test.each([
    '<svg onload=alert(1)></svg>',
    '<svg><script>alert(1)</script></svg>',
    '<svg viewBox="0 0 1 1"><path d="M0 0h1"></path></svg>',
    '<p>x</p><svg><line x1="0" x2="1" y1="0" y2="1"></line></svg>',
    '<span class="not-katex"><svg><path d="M0 0"></path></svg></span>',
    '<svg class="katex" width="1em" height="1em"><path d="M0 0"></path></svg>',
    '<p><svg class="katex"><line x1="0" x2="1" y1="0" y2="1"></line></svg></p>',
  ])('removes svg outside .katex: %s', (src) => {
    const out = parse(sanitizeHtml(src));
    expect(out.querySelector('svg,path,line,script')).toBeNull();
    expect(out.querySelector('[onload]')).toBeNull();
  });

  test.each([
    '<span class="katex"><svg onload="alert(1)"><path d="M0 0"></path></svg></span>',
    '<span class="katex"><svg href="https://evil.example"><path d="M0 0"></path></svg></span>',
    '<span class="katex"><svg xlink:href="https://evil.example"><path d="M0 0"></path></svg></span>',
    '<span class="katex"><svg><path d="M0 0" onclick="alert(1)"></path></svg></span>',
    '<span class="katex"><svg><path d="M0 0" href="javascript:alert(1)"></path></svg></span>',
    '<span class="katex"><svg><script>alert(1)</script><a href="https://evil.example"><path d="M0 0"></path></a></svg></span>',
    '<span class="katex"><svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg></span>',
    '<span class="katex"><svg><use href="#x"></use><animate onbegin="alert(1)"></animate></svg></span>',
  ])('drops svg that carries handlers, links or active content: %s', (src) => {
    const out = parse(sanitizeHtml(src));
    expect(out.querySelector('script,img,use,animate,foreignObject')).toBeNull();
    expect(out.querySelector('svg a, path[href], svg[href]')).toBeNull();
    for (const el of out.querySelectorAll('*')) {
      expect(el.getAttributeNames().filter((n) => /^on|href/i.test(n))).toEqual([]);
    }
    expect(out.querySelector('svg')).toBeNull();
  });

  test('svg style goes through the same unsafe-value filter', () => {
    const out = parse(
      sanitizeHtml(
        '<span class="katex"><svg style="background:url(https://evil.example/x)"><path d="M0 0" style="position:fixed"></path></svg></span>',
      ),
    );
    expect(out.querySelector('svg')?.hasAttribute('style')).toBe(false);
    expect(out.querySelector('path')?.hasAttribute('style')).toBe(false);
  });
});

describe('sanitizeHighlightedHtml', () => {
  test('keeps colors on tokens and drops everything unsafe', () => {
    const html =
      '<pre class="shiki" style="color:#000" tabindex="0"><code><span class="line"><span style="--shiki-light:#24292e">x</span></span></code></pre><img src=x onerror=alert(1)><script>1</script>';
    const out = parse(sanitizeHighlightedHtml(html));
    expect(out.querySelector('pre.shiki')?.getAttribute('style')).toContain('color:#000');
    expect(out.querySelector('span[style]')).not.toBeNull();
    expect(out.querySelector('img,script')).toBeNull();
  });
});
