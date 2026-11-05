import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';
import { htmlToText, wholeDocument } from './html-text';

const article = readFileSync(
  new URL('../../../test-support/fixtures/article.html', import.meta.url),
  'utf8',
);

test('reads the article and drops page furniture', () => {
  const { title, text } = htmlToText(article, 'https://example.org/blog/caching');
  expect(title).toBe('Panduan caching');
  expect(text).toContain('Caching menyimpan salinan data');
  expect(text).not.toMatch(/Beranda|Hak cipta|tracker/);
  expect(text).not.toContain('<');
});

test('falls back to the body text when there is no article', () => {
  const { title, text } = htmlToText(
    '<html><head><title> Kecil </title></head><body><nav>menu</nav><p>Satu</p><p>Dua</p></body></html>',
    'https://example.org/',
  );
  expect(title).toBe('Kecil');
  expect(text).toContain('Satu');
  expect(text).toContain('Dua');
});

test('survives empty and broken markup', () => {
  expect(htmlToText('', 'https://example.org/')).toEqual({ title: '', text: '' });
  expect(htmlToText('<p>tidak <b>ditutup', 'https://example.org/').text).toBe('tidak ditutup');
});

test('markup in text stays text', () => {
  const { text } = htmlToText(
    '<body><p>&lt;script&gt;alert(1)&lt;/script&gt;</p></body>',
    'https://a.b/',
  );
  expect(text).toBe('<script>alert(1)</script>');
});

test('the title is one line of at most 300 characters', () => {
  const forged = htmlToText(
    '<html><head><title>A\nURL: x\n\n  B</title></head><body><p>Isi</p></body></html>',
    'https://a.b/',
  );
  expect(forged.title).toBe('A URL: x B');
  const long = htmlToText(
    `<html><head><title>${'T'.repeat(5_000)}</title></head><body><p>Isi</p></body></html>`,
    'https://a.b/',
  );
  expect(long.title).toHaveLength(300);
});

test('a page wrapped in a form keeps its text', () => {
  const { text } = htmlToText(
    '<body><form><div><p>Di dalam formulir</p></div></form></body>',
    'https://a.b/',
  );
  expect(text).toBe('Di dalam formulir');
});

test('a page whose text sits in header or nav elements is still read', () => {
  const { text } = htmlToText(
    '<body><header><nav>Hanya menu</nav></header></body>',
    'https://a.b/',
  );
  expect(text).toBe('Hanya menu');
});

test('markup without optional html, head and body tags is read in full', () => {
  const a = htmlToText('<!doctype html><title>T</title><p>isi halaman</p>', 'https://a.b/');
  expect(a.title).toBe('T');
  expect(a.text).toContain('isi halaman');
  expect(htmlToText('<p>a</p><p>b</p>', 'https://a.b/').text).toBe('a\n\nb');
});

test.each([
  [
    'a script holding "<html>"',
    '<!doctype html><title>T</title><p>one</p><script>var s="<html>"</script><p>two</p><p>three</p>',
  ],
  [
    'a comment holding "<html>"',
    '<!doctype html><!-- was <html> once --><title>T</title><p>one</p><p>two</p><p>three</p>',
  ],
  [
    'a conditional comment',
    '<!doctype html><!--[if IE]><html class="ie"><![endif]--><title>T</title><p>one</p><p>two</p><p>three</p>',
  ],
  [
    'an attribute holding "<html>"',
    '<!doctype html><title>T</title><p data-x="<html>">one</p><p>two</p><p>three</p>',
  ],
  [
    'a textarea holding "<html>"',
    '<title>T</title><p>one</p><textarea><html></textarea><p>two</p><p>three</p>',
  ],
])('a literal <html> inside %s does not cut the page short', (_name, html) => {
  const { text } = htmlToText(html, 'https://a.b/');
  expect(text).toContain('one');
  expect(text).toContain('two');
  if (html.includes('three')) expect(text).toContain('three');
});

test('a real <html> tag after a doctype and comments is left alone', () => {
  const html =
    '  <!doctype html><!-- c --><html><head><title>T</title></head><body><p>one</p><p>two</p></body></html>';
  expect(htmlToText(html, 'https://a.b/')).toEqual({ title: 'T', text: 'one\n\ntwo' });
});

test('page furniture and sectioning elements each start a new line', () => {
  const furniture = htmlToText(
    '<header>a</header><nav>b</nav><aside>c</aside><footer>d</footer>',
    'https://a.b/',
  );
  expect(furniture.text.length).toBeGreaterThan(0);
  expect(furniture.text).not.toMatch(/[a-d][a-d]/);
  const sections = htmlToText(
    '<main>w</main><details>x</details><figure>y</figure><address>z</address>',
    'https://a.b/',
  );
  expect(sections.text).toBe('w\nx\ny\nz');
});

/**
 * Runs `work` and times it, ending it outright after 5 s: a runaway regex never yields, so
 * without this a regression would hang the test run instead of failing it.
 */
function timed<T>(work: () => T): { value: T; ms: number } {
  let ms = Number.POSITIVE_INFINITY;
  const run = () => {
    const started = performance.now();
    const value = work();
    ms = performance.now() - started;
    return value;
  };
  return { value: runInNewContext('run()', { run }, { timeout: 5_000 }) as T, ms };
}

const FAST_MS = 100;
const wrap = (html: string) => `<html><body>${html}</body></html>`;

test('dozens of comments before a fragment do not stall the read', () => {
  const { value, ms } = timed(() => htmlToText(`${'<!---->'.repeat(60)}<p>x</p>`, 'https://a.b/'));
  expect(value.text).toBe('x');
  expect(ms).toBeLessThan(FAST_MS);
});

test('dozens of prologs before a fragment do not stall the read', () => {
  const { value, ms } = timed(() => htmlToText(`${'<?xml?>'.repeat(60)}<p>x</p>`, 'https://a.b/'));
  expect(value.text).toBe('x');
  expect(ms).toBeLessThan(FAST_MS);
});

test.each([
  ['comments', '<!---->'],
  ['prologs', '<?xml?>'],
])('50,000 %s are skipped quickly, with or without <html> after them', (_name, unit) => {
  const opened = `${unit.repeat(50_000)}<html>`;
  const fragment = `${unit.repeat(50_000)}<p>x</p>`;
  const matched = timed(() => wholeDocument(opened));
  expect(matched.value === opened).toBe(true);
  expect(matched.ms).toBeLessThan(FAST_MS);
  const wrapped = timed(() => wholeDocument(fragment));
  expect(wrapped.value === wrap(fragment)).toBe(true);
  expect(wrapped.ms).toBeLessThan(FAST_MS);
});

test('one comment or prolog as long as the largest page still fits the regex stack', () => {
  const body = 'a'.repeat(2 * 1024 * 1024);
  for (const page of [`<!--${body}--><html>`, `<?xml${body}?><html>`]) {
    expect(timed(() => wholeDocument(page)).value === page).toBe(true);
  }
});

test.each([
  '  <!doctype html><!-- c --><html>',
  '<?xml version="1.0" encoding="UTF-8"?><html>',
  '<?xml version="1.0"?>\n<!-- c -->\n<!DOCTYPE html>\n<html lang="id">',
  '<!-- c --><?xml version="1.0"?><html>',
])('%j opens with <html> and is not wrapped', (html) => {
  expect(wholeDocument(html)).toBe(html);
});

test('a prolog only skips what it holds: an <html> inside it does not open the document', () => {
  const html = '<?xml version="1.0" note="<html>"?><p>one</p>';
  expect(wholeDocument(html)).toBe(wrap(html));
});

test('an XHTML page with a prolog keeps its title and text', () => {
  const html =
    '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>T</title></head><body><p>one</p><p>two</p></body></html>';
  expect(htmlToText(html, 'https://a.b/')).toEqual({ title: 'T', text: 'one\n\ntwo' });
});
