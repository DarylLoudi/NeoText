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
