export type MarkdownEngine = typeof import('./pipeline');

let engine: MarkdownEngine | null = null;
let loading: Promise<MarkdownEngine> | null = null;

/** The loaded renderer, or null while its chunk has not arrived yet. */
export function markdownEngine(): MarkdownEngine | null {
  return engine;
}

/**
 * Loads markdown-it and DOMPurify as a lazy chunk, so the startup bundle stays small. Until it
 * arrives, messages show their text as written.
 */
export function ensureMarkdown(): Promise<MarkdownEngine> {
  loading ??= import('./pipeline').then(
    (loaded) => {
      engine = loaded;
      return loaded;
    },
    (error: unknown) => {
      loading = null; // a failed chunk load may succeed on the next attempt
      throw error;
    },
  );
  return loading;
}

/** Fetches the renderer once the browser is idle, before the first message needs it. */
export function prefetchMarkdown(): () => void {
  if (engine) return () => {};
  const load = () => void ensureMarkdown().catch(() => undefined);
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(load, { timeout: 2000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(load, 0);
  return () => clearTimeout(id);
}
