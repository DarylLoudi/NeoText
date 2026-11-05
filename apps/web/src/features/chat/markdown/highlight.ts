import type { HighlighterCore, LanguageInput, ThemeRegistrationRaw } from 'shiki/core';
import { type CardMode, withReadableColors } from './contrast';
import { sanitizeHighlightedHtml } from './sanitize';

export type CodeTheme = 'auto' | 'vitesse' | 'min';

/**
 * Shiki's JS regex engine tokenizes at roughly 16 microseconds per character, synchronously, so
 * longer blocks would freeze the page for seconds. They render plain in the same card instead.
 */
const MAX_HIGHLIGHT_CHARS = 24_000;
const MAX_LINE_LENGTH = 2_000;
const TIME_LIMIT_MS = 500;

const THEME_PAIRS: Record<CodeTheme, { light: string; dark: string }> = {
  auto: { light: 'github-light', dark: 'github-dark-dimmed' },
  vitesse: { light: 'vitesse-light', dark: 'vitesse-dark' },
  min: { light: 'min-light', dark: 'min-dark' },
};

// Explicit imports (not a computed path) so the bundler can emit one lazy chunk per file.
type ThemeModule = { default: ThemeRegistrationRaw };
const THEMES: Record<string, () => Promise<ThemeModule>> = {
  'github-light': () => import('shiki/themes/github-light.mjs'),
  'github-dark-dimmed': () => import('shiki/themes/github-dark-dimmed.mjs'),
  'vitesse-light': () => import('shiki/themes/vitesse-light.mjs'),
  'vitesse-dark': () => import('shiki/themes/vitesse-dark.mjs'),
  'min-light': () => import('shiki/themes/min-light.mjs'),
  'min-dark': () => import('shiki/themes/min-dark.mjs'),
};

const LANGS: Record<string, () => Promise<LanguageInput>> = {
  bash: () => import('shiki/langs/bash.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  dart: () => import('shiki/langs/dart.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  latex: () => import('shiki/langs/latex.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  r: () => import('shiki/langs/r.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  scala: () => import('shiki/langs/scala.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  svelte: () => import('shiki/langs/svelte.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
};

const ALIASES: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'shellscript',
  shell: 'shellscript',
  zsh: 'shellscript',
  console: 'shellscript',
  ps1: 'powershell',
  pwsh: 'powershell',
  yml: 'yaml',
  md: 'markdown',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  kt: 'kotlin',
  tex: 'latex',
  htm: 'html',
  docker: 'dockerfile',
  patch: 'diff',
  gql: 'graphql',
};

let highlighterPromise: Promise<HighlighterCore> | null = null;

/** One shared Shiki core on the JavaScript regex engine: no WASM, no eval, CSP-safe. */
function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ]);
    return createHighlighterCore({
      engine: createJavaScriptRegexEngine({ forgiving: true }),
      themes: [],
      langs: [],
    });
  })().catch((error: unknown) => {
    highlighterPromise = null;
    throw error;
  });
  return highlighterPromise;
}

const readableThemes = new Map<string, Promise<ThemeRegistrationRaw>>();

/** Loads a theme chunk once and fixes its low-contrast token colors for the code card. */
function loadReadableTheme(name: string, mode: CardMode): Promise<ThemeRegistrationRaw> {
  const load = THEMES[name];
  if (!load) return Promise.reject(new Error(`Unknown code theme ${name}`));
  let ready = readableThemes.get(name);
  if (!ready) {
    ready = load().then((module) => withReadableColors(module.default, mode));
    ready.catch(() => readableThemes.delete(name));
    readableThemes.set(name, ready);
  }
  return ready;
}

function resolveLanguage(lang: string): string | null {
  const key = lang.trim().toLowerCase();
  const name = ALIASES[key] ?? key;
  return Object.hasOwn(LANGS, name) ? name : null;
}

/**
 * Highlights code with Shiki, loading the grammar and theme on first use. Colors come out as
 * `--shiki-light` / `--shiki-dark` variables so a theme switch needs no second pass. Returns null
 * for unknown languages, oversized input, or any failure; callers keep the plain block then.
 */
export async function highlightCode(
  code: string,
  lang: string,
  theme: CodeTheme,
): Promise<string | null> {
  const language = resolveLanguage(lang);
  const loadLanguage = language ? LANGS[language] : undefined;
  if (!language || !loadLanguage || code.length > MAX_HIGHLIGHT_CHARS) return null;

  try {
    const pair = THEME_PAIRS[theme];
    // Start every chunk download at once; the highlighter itself is one of them.
    const [highlighter, light, dark, grammar] = await Promise.all([
      getHighlighter(),
      loadReadableTheme(pair.light, 'light'),
      loadReadableTheme(pair.dark, 'dark'),
      loadLanguage(),
    ]);
    await Promise.all([
      highlighter.loadTheme(light),
      highlighter.loadTheme(dark),
      highlighter.loadLanguage(grammar),
    ]);
    const html = highlighter.codeToHtml(code, {
      lang: language,
      themes: pair,
      defaultColor: false,
      tokenizeMaxLineLength: MAX_LINE_LENGTH,
      tokenizeTimeLimit: TIME_LIMIT_MS,
    });
    return sanitizeHighlightedHtml(html);
  } catch {
    return null;
  }
}
