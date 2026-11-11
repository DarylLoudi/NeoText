import { type ModelRef, modelKey } from '@neotext/shared';
import { useMemo, useSyncExternalStore } from 'react';

/** The most models one turn can go to (the server takes up to four targets). */
export const MAX_COMPARE = 4;

export interface CompareState {
  enabled: boolean;
  /** The models chosen for the next turn; empty means "the model in use". */
  targets: readonly ModelRef[];
  /** User message ids whose side-by-side answers were settled with "Continue with this answer". */
  chosen: ReadonlySet<string>;
}

const CHOSEN_KEY = 'neotext:compare-chosen';
/** Only the newest picks are kept, so the stored list stays small. */
const CHOSEN_KEPT = 500;

/** Ids of turns the user settled, read back after a reload; message ids hold no content. */
function loadChosen(): Set<string> {
  try {
    const raw = localStorage.getItem(CHOSEN_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

function saveChosen(chosen: ReadonlySet<string>): void {
  try {
    localStorage.setItem(CHOSEN_KEY, JSON.stringify([...chosen].slice(-CHOSEN_KEPT)));
  } catch {
    // Storage unavailable: the pick still holds until the page reloads.
  }
}

/**
 * Compare on/off and its models last for this browser session only: a reload starts with compare
 * off. Which answers were picked is remembered across reloads (`neotext:compare-chosen`), because
 * a pick is a decision about a finished turn, not a setting for the next one.
 */
let state: CompareState = { enabled: false, targets: [], chosen: loadChosen() };
const listeners = new Set<() => void>();

function commit(next: Partial<CompareState>): void {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCompareState(): CompareState {
  return state;
}

/**
 * Turns compare on or off. Turning it on with nothing chosen yet stores `current` (the model
 * in use) as the first target, so its chip behaves like any other.
 */
export function toggleCompare(current?: ModelRef | null): void {
  const enabled = !state.enabled;
  if (enabled && state.targets.length === 0 && current) {
    commit({ enabled, targets: [current] });
  } else commit({ enabled });
}

/** Stores the model in use when compare is on with nothing chosen (turned on elsewhere). */
export function seedCompareTargets(current: ModelRef): void {
  if (state.enabled && state.targets.length === 0) commit({ targets: [current] });
}

/** Keeps the first four distinct models, in order; at least one always stays chosen. */
export function setCompareTargets(refs: readonly ModelRef[]): void {
  if (refs.length === 0 && state.targets.length > 0) return;
  const seen = new Set<string>();
  const targets = refs.filter((r) => {
    const key = modelKey(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  commit({ targets: targets.slice(0, MAX_COMPARE) });
}

/** The answers to this user message are settled: the thread shows the chosen one normally. */
export function chooseAnswer(userMessageId: string): void {
  if (state.chosen.has(userMessageId)) return;
  const chosen = new Set([...state.chosen, userMessageId]);
  saveChosen(chosen);
  commit({ chosen });
}

/** Brings the side-by-side columns back for this user message. */
export function showComparison(userMessageId: string): void {
  if (!state.chosen.has(userMessageId)) return;
  const chosen = new Set(state.chosen);
  chosen.delete(userMessageId);
  saveChosen(chosen);
  commit({ chosen });
}

export function isChosen(userMessageId: string): boolean {
  return state.chosen.has(userMessageId);
}

/** What a send in compare mode goes to: the chosen models, else the one in use. */
export function compareTargets(targets: readonly ModelRef[], current: ModelRef | null): ModelRef[] {
  if (targets.length > 0) return [...targets];
  return current ? [current] : [];
}

/** The selector must return a stable value (a stored object, a primitive). */
export function useCompare<T>(selector: (s: CompareState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  );
}

export function useCompareState() {
  const enabled = useCompare((s) => s.enabled);
  const targets = useCompare((s) => s.targets);
  return useMemo(
    () => ({ enabled, targets, toggle: toggleCompare, setTargets: setCompareTargets }),
    [enabled, targets],
  );
}

/** For tests: compare off, nothing chosen. */
export function resetCompare(): void {
  state = { enabled: false, targets: [], chosen: new Set() };
  saveChosen(state.chosen);
  for (const fn of listeners) fn();
}
