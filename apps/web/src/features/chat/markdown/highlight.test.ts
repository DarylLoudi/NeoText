// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { highlightCode } from './highlight';

test('highlights a known language with light and dark variables', async () => {
  const html = await highlightCode('const a = 1;', 'ts', 'auto');
  expect(html).toContain('class="shiki');
  expect(html).toContain('--shiki-light');
  expect(html).toContain('--shiki-dark');
  expect(html).toContain('const');
});

test('escapes code and never emits live markup', async () => {
  const html = await highlightCode('<img src=x onerror=alert(1)>', 'html', 'vitesse');
  const root = document.createElement('div');
  root.innerHTML = html ?? '';
  expect(root.querySelector('img')).toBeNull();
  expect(root.textContent).toContain('onerror=alert(1)');
});

test('unknown languages return null', async () => {
  expect(await highlightCode('x', 'definitely-not-a-language', 'auto')).toBeNull();
  expect(await highlightCode('x', '', 'auto')).toBeNull();
});

test('supports the other themes and language aliases', async () => {
  expect(await highlightCode('print(1)', 'py', 'min')).toContain('<span');
  expect(await highlightCode('echo hi', 'sh', 'vitesse')).toContain('<span');
});

test('blocks over 24,000 characters are left plain, smaller ones are highlighted', async () => {
  expect(await highlightCode('x'.repeat(300_000), 'js', 'auto')).toBeNull();
  expect(await highlightCode('a;\n'.repeat(8_334), 'js', 'auto')).toBeNull();
  expect(await highlightCode('let a = 1;\n'.repeat(100), 'js', 'auto')).toContain('<span');
});

test('a very long line does not stall tokenization', async () => {
  const started = performance.now();
  const html = await highlightCode(`const s = "${'x'.repeat(20_000)}";`, 'js', 'auto');
  expect(html).not.toBeNull();
  expect(performance.now() - started).toBeLessThan(3000);
});

// The code card sits on --shelf, so every token color must stay readable there (WCAG AA 4.5:1).
const SHELF = { light: '#f1f2ef', dark: '#16191c' };
function channel(hex: string, i: number): number {
  const c = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  return 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const SAMPLES: Record<string, string> = {
  typescript:
    '// a comment\n/** doc */\nconst re = /a+/g;\nlet n: number = 1 + 2;\nfunction f(x: string) { return `t` + x; }\n',
  html: '<!-- c --><div class="a" id="b">text &amp; more</div>\n',
  markdown: '# Title\n> quote\n- item\n[link](https://x.org) `code` **bold**\n',
  diff: '@@ -1 +1 @@\n-old\n+new\n',
  python: '# c\ndef f(a, *b, **c):\n    return {"k": 1.5}\n',
};

describe.each(['auto', 'vitesse', 'min'] as const)('token colors in theme %s', (theme) => {
  test.each(['light', 'dark'] as const)('stay at least 4.5:1 on the %s card', async (mode) => {
    const colors = new Set<string>();
    for (const [lang, code] of Object.entries(SAMPLES)) {
      const html = (await highlightCode(code, lang, theme)) ?? '';
      for (const m of html.matchAll(new RegExp(`--shiki-${mode}:(#[0-9a-fA-F]{6,8})`, 'g'))) {
        colors.add((m[1] ?? '').toLowerCase());
      }
    }
    expect(colors.size).toBeGreaterThan(3);
    for (const color of colors) {
      expect(color.length, `${color} must be opaque`).toBe(7);
      expect(contrast(color, SHELF[mode]), `${theme} ${mode} ${color}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
