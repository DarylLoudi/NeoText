// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { splitBlocks } from './blocks';
import { Markdown } from './Markdown';
import { type RenderOptions, renderBlock } from './render';

vi.mock('./render', async (importOriginal) => {
  const original = await importOriginal<typeof import('./render')>();
  return { ...original, renderBlock: vi.fn(original.renderBlock) };
});

const renderSpy = vi.mocked(renderBlock);
const opts: RenderOptions = { copyLabel: 'Copy', loadImageLabel: (h) => h };

beforeEach(() => {
  renderSpy.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('streaming', () => {
  test('only the last block re-renders while streaming', () => {
    const { rerender } = render(<Markdown text={'one\n\ntwo\n\nthr'} streaming />);
    expect(renderSpy).toHaveBeenCalledTimes(3);

    renderSpy.mockClear();
    rerender(<Markdown text={'one\n\ntwo\n\nthree'} streaming />);
    expect(renderSpy).toHaveBeenCalledTimes(1);

    renderSpy.mockClear();
    rerender(<Markdown text={'one\n\ntwo\n\nthree and more'} streaming />);
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(renderSpy.mock.calls[0]?.[0]).toBe('three and more');
  });

  test('closes dangling markers in the live block only', () => {
    render(<Markdown text={'done **ok**\n\nnow **bold'} streaming />);
    expect(screen.getByText('bold').tagName).toBe('STRONG');
  });

  test('does not repair once streaming ends', () => {
    render(<Markdown text="now **bold" />);
    expect(document.querySelector('strong')).toBeNull();
  });
});

describe('code blocks', () => {
  const fence = 'Here:\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n';

  test('copy button copies the code and confirms for two seconds', async () => {
    const user = userEvent.setup(); // installs its own clipboard stub, so replace it afterwards
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<Markdown text={fence} />);

    const button = screen.getByRole('button', { name: 'Copy' });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await user.click(button);
    expect(writeText).toHaveBeenCalledWith('const a = 1;\n\nconst b = 2;\n');
    await waitFor(() => expect(button).toHaveTextContent('Copied'));
    vi.advanceTimersByTime(2100);
    await waitFor(() => expect(button).toHaveTextContent('Copy'));
    expect(button).not.toHaveTextContent('Copied');
  });

  test('a full HTML page or a named .html block gets a Preview button that opens the preview', async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();
    const page = '```html\n<!doctype html>\n<p>a</p>\n```\n\n```html about.html\n<p>b</p>\n```\n';
    render(
      <Markdown
        text={`${page}\n\`\`\`css\np{}\n\`\`\`\n\n\`\`\`html\n<p>c</p>\n\`\`\`\n`}
        onPreview={onPreview}
      />,
    );
    const buttons = screen.getAllByRole('button', { name: 'Preview' });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[0] as HTMLElement);
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  test('without a preview handler there is no Preview button', () => {
    render(<Markdown text={'```html\n<!doctype html>\n<p>a</p>\n```\n'} />);
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
  });

  test('completed code blocks are highlighted once, after idle', async () => {
    render(<Markdown text={fence} />);
    await waitFor(() => expect(document.querySelector('pre.shiki')).not.toBeNull());
    expect(document.querySelectorAll('.md-code pre')).toHaveLength(1);
    // The copy button still reads the highlighted code.
    expect(document.querySelector('.md-code code')?.textContent).toContain('const a = 1;');
  });

  test('a block still streaming is not highlighted', async () => {
    render(<Markdown text={'```ts\nconst a = 1;'} streaming />);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(document.querySelector('pre.shiki')).toBeNull();
  });

  test('scrollable regions can take keyboard focus', () => {
    render(<Markdown text={'```\nx\n```\n\n| a |\n|---|\n| 1 |'} />);
    expect(document.querySelector('.md-code pre')).toHaveAttribute('tabindex', '0');
    expect(document.querySelector('.md-table')).toHaveAttribute('tabindex', '0');
  });
});

describe('images', () => {
  test('clicking load image inserts an img with no referrer', async () => {
    const user = userEvent.setup();
    render(<Markdown text="![a cat](https://img.example/cat.png)" />);
    expect(document.querySelector('img')).toBeNull();

    await user.click(screen.getByRole('button', { name: /img\.example/ }));
    const img = document.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('src')).toBe('https://img.example/cat.png');
    expect(img?.getAttribute('alt')).toBe('a cat');
    expect(document.querySelector('.md-load-image')).toBeNull();
  });
});

describe('math', () => {
  test('loads KaTeX only when the text has math, then re-renders', async () => {
    render(<Markdown text={'Plain text\n\nEuler: $e^{i\\pi}+1=0$'} />);
    await waitFor(() => expect(document.querySelector('.katex')).not.toBeNull());
  });
});

describe('hostile output', () => {
  test('never produces live scripts, handlers or javascript links in the DOM', () => {
    render(
      <Markdown
        text={
          '<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))\n\n<script>alert(1)</script>'
        }
      />,
    );
    expect(document.querySelector('script,img,iframe')).toBeNull();
    expect(document.querySelector('a')).toBeNull();
  });
});

test('every rendered block carries dir auto', () => {
  const { container } = render(<Markdown text={'مرحبا\n\nHello'} />);
  const wrappers = container.querySelectorAll('div[dir="auto"]');
  expect(wrappers.length).toBeGreaterThanOrEqual(2);
});

test('renders a 100k character message within budget', () => {
  const text = Array.from({ length: 500 }, (_, i) => `Paragraf ${i} ${'kata '.repeat(40)}`).join(
    '\n\n',
  );
  expect(text.length).toBeGreaterThan(100_000);
  const t0 = performance.now();
  splitBlocks(text).forEach((b) => {
    renderBlock(b, opts);
  });
  expect(performance.now() - t0).toBeLessThan(1000);
});
