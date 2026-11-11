import type { MarkdownIt } from 'markdown-it';

type MathPlugin = (md: MarkdownIt, options: unknown) => void;
interface MathModules {
  plugin: MathPlugin & { katex?: unknown };
  katex: unknown;
}

let modules: MathModules | null = null;
let loading: Promise<void> | null = null;

/**
 * Cheap check for `$…$`, `$$…$$`, `\(…\)` or `\[…\]`, so KaTeX is only downloaded for messages
 * that use it.
 */
export function hasMath(text: string): boolean {
  return (
    text.includes('$$') ||
    /\$[^\s$][^$\n]*\$/.test(text) ||
    /\\\(.+?\\\)/s.test(text) ||
    /\\\[.+?\\\]/s.test(text)
  );
}

export function isMathReady(): boolean {
  return modules !== null;
}

/** Loads KaTeX, its stylesheet (with fonts) and the markdown-it plugin as lazy chunks. */
export function ensureMath(): Promise<void> {
  loading ??= (async () => {
    const [katex, texmath] = await Promise.all([
      import('katex'),
      import('markdown-it-texmath'),
      import('katex/dist/katex.min.css'),
    ]);
    const engine = katex.default;
    const plugin = (texmath.default ?? texmath) as MathModules['plugin'];
    plugin.katex = engine; // texmath keeps its renderer on itself; never let it `require` one
    modules = { plugin, katex: engine };
  })().catch((error: unknown) => {
    loading = null; // a failed chunk load may succeed on the next attempt
    throw error;
  });
  return loading;
}

/**
 * Adds `$…$` / `$$…$$` and `\(…\)` / `\[…\]` support to a markdown-it instance once KaTeX has loaded. Returns whether
 * the plugin is now active, so callers can retry on a later render.
 */
export function applyMath(md: MarkdownIt): boolean {
  if (!modules) return false;
  md.use(modules.plugin, {
    engine: modules.katex,
    delimiters: ['dollars', 'brackets'],
    katexOptions: {
      output: 'html',
      trust: false,
      strict: 'ignore',
      throwOnError: false,
      maxSize: 50,
      maxExpand: 1000,
    },
  });
  // texmath reads `\[…\]` only at the start of a block; models also write it mid-sentence.
  // Render that like an inline `$$…$$`, as display math.
  md.inline.ruler.before('escape', 'math_inline_bracket', (state, silent) => {
    const start = state.pos;
    if (!state.src.startsWith('\\[', start)) return false;
    const end = state.src.indexOf('\\]', start + 2);
    if (end < 0 || !state.src.slice(start + 2, end).trim()) return false;
    if (!silent) {
      const token = state.push('math_inline_double', 'math', 0);
      token.content = state.src.slice(start + 2, end);
      token.markup = '\\[';
    }
    state.pos = end + 2;
    return true;
  });
  return true;
}
