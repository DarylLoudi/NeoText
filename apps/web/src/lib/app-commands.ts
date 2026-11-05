import { useEffect, useRef } from 'react';

/**
 * Things only a mounted screen knows how to do. The screen registers its handler while it is
 * on the page; shortcuts and the command palette run it by id and do nothing when no screen
 * has one.
 */
export type AppCommandId = 'toggle-sidebar' | 'focus-composer' | 'switch-model';

type Handlers = {
  'toggle-sidebar': () => void;
  'focus-composer': () => void;
  'switch-model': (ref: { providerId: string; modelId: string }) => void;
};

const registry = new Map<AppCommandId, (arg?: never) => void>();

export function registerAppCommand<K extends AppCommandId>(id: K, run: Handlers[K]): () => void {
  registry.set(id, run as (arg?: never) => void);
  return () => {
    if (registry.get(id) === run) registry.delete(id);
  };
}

/** Runs the screen's handler. Returns false when no screen has one. */
export function runAppCommand<K extends AppCommandId>(
  id: K,
  ...args: Parameters<Handlers[K]>
): boolean {
  const run = registry.get(id) as ((...a: unknown[]) => void) | undefined;
  if (!run) return false;
  run(...args);
  return true;
}

export function hasAppCommand(id: AppCommandId): boolean {
  return registry.has(id);
}

/** Registers `run` for as long as the component is mounted; always calls the latest closure. */
export function useAppCommand<K extends AppCommandId>(id: K, run: Handlers[K]): void {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    const stable = ((...args: unknown[]) =>
      (latest.current as (...a: unknown[]) => void)(...args)) as Handlers[K];
    return registerAppCommand(id, stable);
  }, [id]);
}
