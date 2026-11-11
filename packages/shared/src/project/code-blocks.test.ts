import { describe, expect, it } from 'vitest';
import { opsFromText } from './code-blocks';

const fence = (info: string, body: string, marker = '```') =>
  `${marker}${info}\n${body}\n${marker}`;
const paths = (text: string) => opsFromText(text).map((op) => op.path);

describe('opsFromText: names', () => {
  it('reads the name from the fence info', () => {
    expect(paths(fence('html index.html', '<p>a</p>'))).toEqual(['index.html']);
    expect(paths(fence('css title="style.css"', 'p{}'))).toEqual(['style.css']);
    expect(paths(fence('js filename=app.js', '1'))).toEqual(['app.js']);
    expect(paths(fence('about.html', '<p>b</p>'))).toEqual(['about.html']);
  });

  it.each(['**style.css**', '`style.css`:', 'style.css', '### style.css'])(
    'reads the name from the line before: %s',
    (line) => {
      expect(paths(`Here it is.\n\n${line}\n${fence('css', 'p{}')}`)).toEqual(['style.css']);
    },
  );

  it('allows one blank line between the name and the block', () => {
    expect(paths(`**app.js**\n\n${fence('js', '1')}`)).toEqual(['app.js']);
  });

  it('does not take a sentence before the block as a name', () => {
    expect(paths(`Save this as style.css please:\n${fence('css', 'p{}')}`)).toEqual([]);
  });

  it('reads the name from a first-line comment and keeps the comment', () => {
    const ops = opsFromText(
      [
        fence('html', '<!-- index.html -->\n<p>a</p>'),
        fence('css', '/* style.css */\np{}'),
        fence('js', '// app.js\n1'),
      ].join('\n\n'),
    );
    expect(ops).toEqual([
      { kind: 'write', path: 'index.html', content: '<!-- index.html -->\n<p>a</p>' },
      { kind: 'write', path: 'style.css', content: '/* style.css */\np{}' },
      { kind: 'write', path: 'app.js', content: '// app.js\n1' },
    ]);
  });

  it('accepts ~~~ fences and normalizes the name', () => {
    expect(paths(fence('css ./css/site.css', 'p{}', '~~~'))).toEqual(['css/site.css']);
  });

  it('skips a block whose name is not allowed', () => {
    expect(paths(fence('sh ../run.sh', 'rm -rf /'))).toEqual([]);
    expect(paths(fence('python main.py', 'print(1)'))).toEqual([]);
  });

  it('skips a block that never closes', () => {
    expect(paths('```html index.html\n<p>a</p>\n')).toEqual([]);
  });
});

describe('opsFromText: unnamed blocks', () => {
  const page = '<!doctype html>\n<html><head><title>x</title></head><body><p>a</p></body></html>';

  it('treats an unnamed full document as index.html', () => {
    expect(opsFromText(fence('html', page))).toEqual([
      { kind: 'write', path: 'index.html', content: page },
    ]);
  });

  it('ignores an unnamed fragment', () => {
    expect(opsFromText(fence('html', '<div>hi</div>'))).toEqual([]);
  });

  it('attaches a lone unnamed css and js block to the unnamed page', () => {
    const ops = opsFromText(
      [fence('html', page), fence('css', 'p{}'), fence('js', '1')].join('\n'),
    );
    expect(ops.map((o) => o.path)).toEqual(['index.html', 'style.css', 'script.js']);
    const html = ops[0]?.kind === 'write' ? ops[0].content : '';
    expect(html).toContain('<link rel="stylesheet" href="style.css">\n</head>');
    expect(html).toContain('<script src="script.js"></script>\n</body>');
  });

  it('does not add a link the page already has', () => {
    const linked = page.replace('</head>', '<link rel="stylesheet" href="style.css"></head>');
    const ops = opsFromText([fence('html', linked), fence('css', 'p{}')].join('\n'));
    const html = ops[0]?.kind === 'write' ? ops[0].content : '';
    expect(html.match(/style\.css/g)).toHaveLength(1);
  });

  it('leaves unnamed css alone when there are two, or no unnamed page', () => {
    expect(
      paths([fence('html', page), fence('css', 'a{}'), fence('css', 'b{}')].join('\n')),
    ).toEqual(['index.html']);
    expect(paths(fence('css', 'p{}'))).toEqual([]);
  });

  it('keeps a later block of the same name after an earlier one', () => {
    expect(paths([fence('css a.css', '1'), fence('css a.css', '2')].join('\n'))).toEqual([
      'a.css',
      'a.css',
    ]);
  });
});
