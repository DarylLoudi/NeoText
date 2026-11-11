// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { splitBlocks } from './blocks';
import { ensureMath, hasMath } from './math';
import { type RenderOptions, renderBlock } from './render';

const opts: RenderOptions = { copyLabel: 'Copy', loadImageLabel: (h) => h };

describe('hasMath', () => {
  test.each([
    ['inline $x^2$ here', true],
    ['$$\nx\n$$', true],
    ['no math, costs 5 dollars', false],
    ['a lone $ sign', false],
    [String.raw`inline \(x^2\) here`, true],
    [String.raw`\[\frac{a}{b}\]`, true],
    ['(plain parentheses)', false],
    ['', false],
  ])('%j -> %s', (text, expected) => {
    expect(hasMath(text)).toBe(expected);
  });
});

describe('math rendering', () => {
  test('is plain text until the math chunk has loaded, then renders KaTeX', async () => {
    expect(renderBlock('Euler: $e^{i\\pi}+1=0$', opts)).not.toContain('class="katex"');
    await ensureMath();
    const out = renderBlock('Euler: $e^{i\\pi}+1=0$', opts);
    expect(out).toContain('class="katex"');
    expect(out).toContain('style="');
    expect(out).not.toContain('<annotation');
  });

  test('renders bracket delimiters', async () => {
    await ensureMath();
    expect(renderBlock(String.raw`Jika \(\alpha = 0\), maka`, opts)).toContain('class="katex"');
    expect(renderBlock(String.raw`\[y(t) = C_1 \cos(\beta t)\]`, opts)).toContain('katex-display');
  });

  test('renders \\[…\\] in the middle of a sentence as display math', async () => {
    await ensureMath();
    const out = renderBlock(
      String.raw`Hasilnya \[ \int_0^1 x^2\,dx = \frac{1}{3} \] jadi selesai.`,
      opts,
    );
    expect(out).toContain('katex-display');
    expect(out).toContain('jadi selesai.');
    expect(out).not.toContain('\\frac');
  });

  test('an unclosed \\[ stays as text', async () => {
    await ensureMath();
    expect(renderBlock(String.raw`a \[ b`, opts)).not.toContain('katex');
  });

  test('display math with blank lines stays one block and renders', async () => {
    await ensureMath();
    const doc = 'before\n\n$$\n\\frac{a}{b}\n\n+ c\n$$\n\nafter';
    expect(splitBlocks(doc)).toHaveLength(3);
    expect(renderBlock('$$\\frac{a}{b}$$', opts)).toContain('katex-display');
  });

  test('trust is off, so \\href and \\htmlClass cannot inject', async () => {
    await ensureMath();
    const out = renderBlock('$\\href{javascript:alert(1)}{x}$ $\\htmlClass{evil}{y}$', opts);
    expect(out).not.toMatch(/javascript:/);
    expect(out).not.toContain('class="evil"');
    expect(out).not.toMatch(/<a /);
  });

  test.each([
    ['\\sqrt{x}', 'path'],
    ['\\overrightarrow{AB}', 'path'],
    ['\\xrightarrow{abc}', 'path'],
    ['\\widehat{abc}', 'path'],
    ['\\overbrace{abc}', 'path'],
    ['\\cancel{abc}', 'line'],
  ])('keeps the drawn part of %s', async (tex, shape) => {
    await ensureMath();
    const root = document.createElement('div');
    root.innerHTML = renderBlock(`$${tex}$`, opts);
    expect(root.querySelector(`.katex svg ${shape}`)).not.toBeNull();
    expect(root.querySelector('[onload],script')).toBeNull();
  });

  test('invalid TeX does not throw', async () => {
    await ensureMath();
    expect(() => renderBlock('$\\frac{$', opts)).not.toThrow();
  });
});
